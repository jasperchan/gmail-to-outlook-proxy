import fs from "node:fs";
import path from "node:path";
import addressparser from "nodemailer/lib/addressparser";

// usage: npm run smtp:fixture -- <name> "<description>" <recording.json>...
// Turns SMTP_RECORD_DIR recordings (one per transaction) into a sanitized scenario
// fixture in tests/fixtures/<name>.json: addresses become example.org addresses without
// display names, trace/threading headers are dropped, Message-IDs are replaced and every
// MIME part's content is blanked (the structure is kept). Still review before committing.

const DROP_HEADERS =
  /^(received|x-received|x-gm-[\w-]+|x-gmail-[\w-]+|x-google-[\w-]+|dkim-signature|arc-[\w-]+|authentication-results|return-path|in-reply-to|references|thread-[\w-]+):/i;
const ADDRESS_HEADERS = /^(from|to|cc|bcc|reply-to|sender):([\s\S]*)$/i;

export type Fixture = {
  name: string;
  description: string;
  source: string;
  sender: string;
  copies: { rcptTo: string[]; raw: string }[];
};

function split(text: string) {
  const match = /\r?\n\r?\n/.exec(text);
  return match
    ? {
        header: text.slice(0, match.index),
        sep: match[0],
        body: text.slice(match.index + match[0].length),
      }
    : { header: text, sep: "", body: "" };
}

function fields(header: string) {
  const out: string[] = [];
  for (const line of header.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1] += "\n" + line;
    } else if (line) {
      out.push(line);
    }
  }
  return out;
}

function parseAddresses(value: string): string[] {
  const out: string[] = [];
  const walk = (list: any[]) =>
    list.forEach((item) =>
      item.group ? walk(item.group) : item.address && out.push(item.address)
    );
  walk(addressparser(value.replace(/\r?\n[ \t]+/g, " ")) as any[]);
  return out;
}

// keeps multipart structure and part headers, replaces leaf content
function blankBody(header: string, body: string, eol: string): string {
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(header)?.[1];
  if (!/^content-type:\s*multipart\//im.test(header) || !boundary) {
    return `(content removed)${eol}`;
  }
  const delimiter = `--${boundary}`;
  const parts = body.split(delimiter);
  return parts
    .map((part, i) => {
      if (i === 0 || part.startsWith("--")) {
        return i === 0 ? "" : part; // drop preamble, keep the closing "--"
      }
      const inner = split(part.replace(/^\r?\n/, ""));
      return `${eol}${inner.header}${inner.sep || eol + eol}${blankBody(
        inner.header,
        inner.body,
        eol
      )}`;
    })
    .join(delimiter);
}

function sanitize(
  text: string,
  addresses: Map<string, string>,
  messageIds: Map<string, string>
) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const { header, body } = split(text);
  const mapAddress = (a: string) =>
    addresses.get(a.toLowerCase()) ?? "unknown@example.org";
  const kept = fields(header)
    .filter((f) => !DROP_HEADERS.test(f))
    .map((f) => {
      const match = ADDRESS_HEADERS.exec(f);
      if (match) {
        return `${match[1]}: ${parseAddresses(match[2])
          .map(mapAddress)
          .join(", ")}`;
      }
      return f
        .replace(/<([^<>\s]+@[^<>\s]+)>/g, (m, id) =>
          messageIds.has(id) ? `<${messageIds.get(id)}>` : m
        )
        .replace(/\n/g, eol);
    });
  return kept.join(eol) + eol + eol + blankBody(header, body, eol);
}

function main() {
  const [name, description, ...files] = process.argv.slice(2);
  if (!name || !description || !files.length) {
    throw new Error(
      'Usage: npm run smtp:fixture -- <name> "<description>" <recording.json>...'
    );
  }
  const recordings = files.map((file) => {
    const meta = JSON.parse(fs.readFileSync(file, "utf8"));
    const raw = fs.readFileSync(
      path.join(path.dirname(file), meta.eml),
      "utf8"
    );
    return { meta, raw };
  });

  // every address in the envelopes and address headers, mapped case-insensitively
  const addresses = new Map<string, string>();
  const add = (address: string, fake?: string) => {
    const key = address.toLowerCase();
    if (!addresses.has(key)) {
      const tag = /\+([^@]+)@/.exec(key)?.[1] ?? `recipient${addresses.size}`;
      addresses.set(key, fake ?? `${tag}@example.org`);
    }
  };
  add(recordings[0].meta.mailFrom as string, "sender@example.com");
  for (const { meta, raw } of recordings) {
    (meta.rcptTo as string[]).forEach((a) => add(a));
    for (const f of fields(split(raw).header)) {
      const match = ADDRESS_HEADERS.exec(f);
      if (match) {
        parseAddresses(match[2]).forEach((a) => add(a));
      }
    }
  }
  const messageIds = new Map<string, string>();
  for (const { raw } of recordings) {
    const id = /^Message-ID:\s*<([^>]+)>/im.exec(raw)?.[1];
    if (id && !messageIds.has(id)) {
      messageIds.set(id, `${name}-${messageIds.size + 1}@example.com`);
    }
  }

  const fixture: Fixture = {
    name,
    description,
    source: `recorded ${recordings[0].meta.receivedAt.slice(
      0,
      10
    )} from ${String(recordings[0].meta.clientHostname).replace(
      /^[^.]+\./,
      "*."
    )}`,
    sender: "sender@example.com",
    copies: recordings.map(({ meta, raw }) => ({
      rcptTo: (meta.rcptTo as string[]).map((r) =>
        addresses.get(r.toLowerCase())!
      ),
      raw: sanitize(raw, addresses, messageIds),
    })),
  };
  const out = path.join(process.cwd(), "tests", "fixtures", `${name}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`Wrote ${out} (${fixture.copies.length} copies)`);
  console.log("Review it for anything personal before committing.");
}

if (require.main === module) {
  main();
}

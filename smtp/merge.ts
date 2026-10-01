import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Splitter, Joiner, Headers } from "@zone-eu/mailsplit";
import addressparser from "nodemailer/lib/addressparser";

// One SMTP transaction as received: the envelope recipients plus the raw message.
export type Copy = { rcptTo: string[]; raw: Buffer };

// Splits the message with mailsplit and lets `edit` change its top-level headers.
// Headers that aren't edited and the body are passed through byte for byte.
async function processMessage(raw: Buffer, edit?: (headers: Headers) => void) {
  let headers: Headers | undefined;
  const rootHeaders = new Transform({
    readableObjectMode: true,
    writableObjectMode: true,
    transform(chunk, _encoding, callback) {
      if (chunk.type === "node" && chunk.root) {
        headers = chunk.headers;
        edit?.(chunk.headers);
      }
      callback(null, chunk);
    },
  });
  const output: Buffer[] = [];
  await pipeline(
    Readable.from([raw]),
    new Splitter(),
    rootHeaders,
    new Joiner(),
    async function (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        output.push(chunk);
      }
    }
  );
  return { raw: Buffer.concat(output), headers: headers! };
}

// header values as written (unfolded), e.g. `"Jane Doe" <Jane.Doe@Example.org>`
function values(headers: Headers, key: string) {
  return headers.getDecoded(key).map((header) => header.value.trim());
}

// comparison key: case-insensitive, with a quoted local part unquoted
function canonical(address: string) {
  const value = address.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at > 0 && value.startsWith('"') && value[at - 1] === '"') {
    return value.slice(1, at - 1).replace(/\\(.)/g, "$1") + value.slice(at);
  }
  return value;
}

// canonical addresses in header values (groups flattened)
function addresses(headerValues: string[]) {
  const out: string[] = [];
  const walk = (list: any[]) => {
    for (const item of list) {
      if (item.group) {
        walk(item.group);
      } else if (item.address && item.address.includes("@")) {
        out.push(canonical(item.address));
      }
    }
  };
  headerValues.forEach((value) => walk(addressparser(value) as any[]));
  return out;
}

function recipientValues(headers: Headers) {
  return {
    to: values(headers, "to"),
    cc: values(headers, "cc"),
    bcc: values(headers, "bcc"),
  };
}

export async function getHeaderAddresses(raw: Buffer) {
  const { to, cc, bcc } = recipientValues((await processMessage(raw)).headers);
  return { to: addresses(to), cc: addresses(cc), bcc: addresses(bcc) };
}

export async function getMessageId(raw: Buffer) {
  const { headers } = await processMessage(raw);
  return headers.getFirst("message-id") || undefined;
}

// Microsoft Graph's MIME sendMail delivers to the To/Cc/Bcc headers, never to the SMTP
// envelope. Gmail's "Send mail as" sends one transaction per recipient with the same
// Message-ID, and only the Bcc recipient's own copy carries a Bcc header naming it; a
// normal client sends one transaction whose envelope has Bcc recipients and no Bcc header.
// Merge all copies of a message into one whose headers name every intended recipient.
// Recipients are added to Bcc exactly as the sender wrote them; a message that already
// names all its recipients is returned unchanged. Canonical forms are only compared.
export async function mergeCopies(copies: Copy[]) {
  const parsed = await Promise.all(
    copies.map(async (copy) => ({
      copy,
      recipients: recipientValues((await processMessage(copy.raw)).headers),
    }))
  );
  const base =
    parsed.find(({ recipients }) => !recipients.bcc.length) ?? parsed[0];
  const { to, cc, bcc } = base.recipients;
  const covered = new Set(addresses([...to, ...cc, ...bcc]));
  const additions: string[] = [];
  for (const { recipients } of parsed) {
    for (const value of recipients === base.recipients ? [] : recipients.bcc) {
      const found = addresses([value]);
      if (found.some((address) => !covered.has(address))) {
        additions.push(value);
        found.forEach((address) => covered.add(address));
      }
    }
  }
  for (const address of copies.flatMap((copy) => copy.rcptTo)) {
    if (!covered.has(canonical(address))) {
      additions.push(address.trim());
      covered.add(canonical(address));
    }
  }
  if (!additions.length) {
    return base.copy.raw;
  }
  const merged = await processMessage(base.copy.raw, (headers) => {
    const value = [...values(headers, "bcc"), ...additions].join(", ");
    if (headers.hasHeader("bcc")) {
      headers.update("Bcc", value);
    } else {
      headers.add("Bcc", value, Infinity);
    }
  });
  return merged.raw;
}

import addressparser from "nodemailer/lib/addressparser";

// One SMTP transaction as received: the envelope recipients plus the raw message.
export type Copy = { rcptTo: string[]; raw: Buffer };

function splitMessage(raw: Buffer) {
  const text = raw.toString("binary");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // a message starting with a blank line has no header block at all
  if (/^\r?\n/.test(text)) {
    return { header: "", rest: eol + text, eol };
  }
  const match = /\r?\n\r?\n/.exec(text);
  if (!match) {
    // headers only, no body
    return { header: text.replace(/\r?\n$/, ""), rest: eol + eol, eol };
  }
  return {
    header: text.slice(0, match.index),
    rest: text.slice(match.index),
    eol,
  };
}

// header lines with folded continuations joined to their field
function headerFields(header: string) {
  const fields: string[] = [];
  for (const line of header.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && fields.length) {
      fields[fields.length - 1] += "\n" + line;
    } else if (line) {
      fields.push(line);
    }
  }
  return fields;
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

function addresses(value: string) {
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
  walk(addressparser(value.replace(/\r?\n[ \t]+/g, " ")) as any[]);
  return out;
}

export function getHeaderAddresses(raw: Buffer) {
  const result = {
    to: [] as string[],
    cc: [] as string[],
    bcc: [] as string[],
  };
  for (const field of headerFields(splitMessage(raw).header)) {
    const match = /^(to|cc|bcc):([\s\S]*)$/i.exec(field);
    if (match) {
      result[match[1].toLowerCase() as "to" | "cc" | "bcc"].push(
        ...addresses(match[2])
      );
    }
  }
  return result;
}

export function getMessageId(raw: Buffer) {
  for (const field of headerFields(splitMessage(raw).header)) {
    const match = /^message-id:([\s\S]*)$/i.exec(field);
    if (match) {
      return match[1].replace(/\s+/g, " ").trim() || undefined;
    }
  }
  return undefined;
}

// Replaces (or removes, when empty) the Bcc header. The body is kept byte for byte.
export function rewriteRecipients(raw: Buffer, bcc: string[]) {
  const { header, rest, eol } = splitMessage(raw);
  const fields = headerFields(header).filter((field) => !/^bcc:/i.test(field));
  if (!fields.length && !bcc.length) {
    return raw;
  }
  if (bcc.length) {
    // folded, one address per line, to stay under the 998 character line limit
    fields.push(`Bcc: ${bcc.join(",\n ")}`);
  }
  return Buffer.from(
    fields.map((field) => field.replace(/\n/g, eol)).join(eol) + rest,
    "binary"
  );
}

// Every envelope recipient, deduped by canonical form.
function envelopeRecipients(copies: Copy[]) {
  const seen = new Map<string, string>();
  for (const address of copies.flatMap((c) => c.rcptTo)) {
    const key = canonical(address);
    if (!seen.has(key)) {
      seen.set(key, address.trim());
    }
  }
  return [...seen.values()];
}

// Microsoft Graph's MIME sendMail delivers to the To/Cc/Bcc headers, never to the SMTP
// envelope. Gmail's "Send mail as" sends one transaction per recipient with the same
// Message-ID, and only the Bcc recipient's own copy carries a Bcc header naming it; a
// normal client sends one transaction whose envelope has Bcc recipients and no Bcc header.
// Merge all copies of a message into one whose headers name every intended recipient.
export function mergeCopies(copies: Copy[]) {
  const base =
    copies.find((c) => getHeaderAddresses(c.raw).bcc.length === 0) ?? copies[0];
  const { to, cc } = getHeaderAddresses(base.raw);
  const visible = new Set([...to, ...cc]);
  const bcc = new Map<string, string>();
  for (const copy of copies) {
    getHeaderAddresses(copy.raw).bcc.forEach((a) => bcc.set(a, a));
  }
  for (const address of envelopeRecipients(copies)) {
    if (!visible.has(canonical(address)) && !bcc.has(canonical(address))) {
      bcc.set(canonical(address), address);
    }
  }
  visible.forEach((a) => bcc.delete(a));
  return rewriteRecipients(base.raw, [...bcc.values()]);
}

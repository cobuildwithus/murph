export class EmailMessage {
  from: string;
  raw: string | ReadableStream<Uint8Array>;
  to: string;

  constructor(from: string, to: string, raw: string | ReadableStream<Uint8Array>) {
    this.from = from;
    this.to = to;
    this.raw = raw;
  }
}

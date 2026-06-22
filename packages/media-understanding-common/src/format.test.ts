// Media Understanding Common tests cover format behavior.
import { describe, expect, it } from "vitest";
import { formatMediaUnderstandingBody } from "./format.js";

describe("formatMediaUnderstandingBody", () => {
  it("replaces placeholder body with transcript", () => {
    const body = formatMediaUnderstandingBody({
      body: "<media:audio>",
      outputs: [
        {
          kind: "audio.transcription",
          attachmentIndex: 0,
          text: "hello world",
          provider: "groq",
        },
      ],
    });
    expect(body).toBe("[Audio]\nTranscript:\nhello world");
  });

  it("includes user text when body is meaningful", () => {
    const body = formatMediaUnderstandingBody({
      body: "caption here",
      outputs: [
        {
          kind: "audio.transcription",
          attachmentIndex: 0,
          text: "transcribed",
          provider: "groq",
        },
      ],
    });
    expect(body).toBe("[Audio]\nUser text:\ncaption here\nTranscript:\ntranscribed");
  });

  it("strips leading media placeholders from user text", () => {
    const body = formatMediaUnderstandingBody({
      body: "<media:audio> caption here",
      outputs: [
        {
          kind: "audio.transcription",
          attachmentIndex: 0,
          text: "transcribed",
          provider: "groq",
        },
      ],
    });
    expect(body).toBe("[Audio]\nUser text:\ncaption here\nTranscript:\ntranscribed");
  });

  it("keeps user text once when multiple outputs exist", () => {
    const body = formatMediaUnderstandingBody({
      body: "caption here",
      outputs: [
        {
          kind: "audio.transcription",
          attachmentIndex: 0,
          text: "audio text",
          provider: "groq",
        },
        {
          kind: "video.description",
          attachmentIndex: 1,
          text: "video text",
          provider: "google",
        },
      ],
    });
    expect(body).toBe(
      [
        "User text:\ncaption here",
        "[Audio]\nTranscript:\naudio text",
        "[Video]\nDescription:\nvideo text",
      ].join("\n\n"),
    );
  });

  it("formats image outputs", () => {
    const body = formatMediaUnderstandingBody({
      body: "<media:image>",
      outputs: [
        {
          kind: "image.description",
          attachmentIndex: 0,
          text: "a cat",
          provider: "openai",
        },
      ],
    });
    expect(body).toBe("[Image]\nDescription:\na cat");
  });

  it("labels audio transcripts by their attachment order", () => {
    const body = formatMediaUnderstandingBody({
      outputs: [
        {
          kind: "audio.transcription",
          attachmentIndex: 0,
          text: "first clip was silent",
          provider: "openclaw",
        },
        {
          kind: "audio.transcription",
          attachmentIndex: 1,
          text: "second clip has speech",
          provider: "groq",
        },
      ],
    });
    expect(body).toBe(
      [
        "[Audio 1/2]\nTranscript:\nfirst clip was silent",
        "[Audio 2/2]\nTranscript:\nsecond clip has speech",
      ].join("\n\n"),
    );
  });

  it("renders speaker-attributed segments when present", () => {
    const body = formatMediaUnderstandingBody({
      outputs: [
        {
          kind: "audio.transcription",
          attachmentIndex: 0,
          text: "ignored plain text",
          provider: "openclaw",
          segments: [
            {
              source: "discord_voice",
              sourceId: "123",
              speakerLabel: "discord:123",
              speakerDisplayName: "Eva",
              speakerConfidence: null,
              startMs: 0,
              endMs: 1000,
              text: "hello",
              words: null,
              attributionSource: "discord_user_stream",
              diarizationModel: null,
              asrModel: null,
            },
            {
              source: "unknown",
              sourceId: null,
              speakerLabel: "speaker_0",
              speakerDisplayName: null,
              speakerConfidence: null,
              startMs: 1000,
              endMs: 2000,
              text: "world",
              words: null,
              attributionSource: "unknown",
              diarizationModel: null,
              asrModel: null,
            },
          ],
        },
      ],
    });
    expect(body).toBe("[Audio]\nTranscript:\n[discord:123]: hello\n[speaker_0]: world");
  });

  it("falls back to plain text when segments are empty", () => {
    const body = formatMediaUnderstandingBody({
      outputs: [
        {
          kind: "audio.transcription",
          attachmentIndex: 0,
          text: "plain fallback",
          provider: "openclaw",
          segments: [],
        },
      ],
    });
    expect(body).toBe("[Audio]\nTranscript:\nplain fallback");
  });
});

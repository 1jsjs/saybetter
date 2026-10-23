# Bee developer friction log — SayBetter

Recorded on October 23, 2026 while building SayBetter on macOS with the Bee iOS app and Bee for Apple Watch
(no Bee hardware), Bee CLI `@beeai/cli` 0.9.0. (The same author's first project, Hearsay, logged the onboarding issues:
https://github.com/1jsjs/hearsay/blob/main/FRICTION_LOG.md)

Each entry: task, steps, expected vs. actual, severity, workaround, suggestion.

## 1. Apple Watch capture silently stops
- Steps: started listening in the Bee watch app, played four English sentences a few minutes later.
- Expected: new utterances on `bee stream`. Actual: nothing; `bee conversations list` showed the conversation's `updated_at` frozen ~15 minutes earlier while `state` stayed `CAPTURING`. Happened twice.
- Severity: High (a coaching app looks broken). Workaround: reopen the Bee watch app and keep the screen awake.
- Suggestion: surface "capture paused" on the watch and phone, emit a stream event when capture stops, and close stale `CAPTURING` sessions.

## 2. ASR quietly "fixes" learner grammar
- Steps: learner sentences with deliberate errors were spoken to the watch.
- Expected: verbatim transcript. Actual: some errors were normalised away ("I didn't said" → "I didn't say"; "I am agree" sometimes → "I'm agree"), others survived ("I go yesterday", "explain me").
- Severity: Medium for language learning (mistakes disappear before they can be coached). Workaround: none; we coach what survives.
- Suggestion: a `verbatim` transcription option or confidence/alternatives per token.

## 3. Stream events do not carry the speaker
- Steps: `bee stream --json --types new-utterance`.
- Expected: speaker label like transcripts have. Actual: no `speaker` on stream utterances.
- Severity: Medium (SayBetter must not coach the other person in a conversation). Workaround: privacy notice; coach only when the user is speaking English.
- Suggestion: add `speaker` (even "self"/"other") to `new-utterance`.

## 4. Two different conversation ids
- Stream utterances use `conversation_uuid`; summaries and REST use numeric `conversation_id`. Joining them needs extra lookups. Suggestion: include both on every event.

## 5. Facts: great, with two surprises
- `bee facts create` worked first time and the fact appeared in the app, and `bee facts update` let us write progress back ("Slipped 2×, got it right in real conversation 1×"). Very nice.
- Surprises: Bee auto-categorised the fact (first "technology", later "health/hobbies") with no way to set a category; and the app shows a "We generated N facts" prompt at the same time, which can confuse users about which facts came from an integration.
- Suggestion: `--category` and a `source` field so integrations can label their facts.

## 6. Todos as reminders work, but there's no "drill done" signal
- `bee todos create --alarm-at` produced alarms that ring on the wrist. But nothing tells the integration when the user completed a todo except polling.
- Suggestion: `todo-updated` already exists on the stream — document its payload (completed flag, id) so apps can react.

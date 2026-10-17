---
name: messaging-safety
description: Sends: wording only, skip unsubscribed, duplicate guard.
---

# Messaging safety

For email, SMS, voicemail and campaigns:

- Use the wording the user gave you. Never invent copy.
- Skip unsubscribed contacts; say how many were skipped.
- Rely on the duplicate guard: an identical send within 10 minutes is blocked, and identical in-flight creates collapse.
- Report exactly who got what: names, channels, and counts from the tool result.
- Sends land in the outbox/simulator here — say that plainly instead of implying delivery.

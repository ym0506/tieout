# Held-out check: Apache Kafka KIP pages

The engine's rules were tuned on the Flink design pages. Kafka's KIP design pages were not looked at while tuning.
They were measured once, on 2026-11-27, after the last rule change (the version-token fix), and the rules were not
changed afterwards. Raw output: `apache-kafka-kips-heldout.json`.

| | Kafka KIP pages |
|---|---|
| Pages read | 1,380 |
| Pages that state a fact Tie-Out can read | 13 |
| Facts Tie-Out could check | 23 |
| Match Jira | 18 |
| Flagged as out of date | 5 |

KIPs are mostly prose. A KIP names its Jira work items in running text and in a "JIRA:" line, and states few
dates, owners or releases next to them, so Tie-Out reads very little here. That is the main result.

Each of the 5 flags, read against the page text:

| Page | Work item | Page says | Jira says | Verdict on the flag |
|---|---|---|---|---|
| KIP-1071 | KAFKA-20116 | "(warmup task support – targeting 4.5.0)" | no fix version | Real disagreement: the page names a target release, Jira has none |
| KIP-1379 | KAFKA-19387 | "Rack awareness is planned for the built-in consumer assignors (KAFKA-19387)" | In Progress | Real disagreement: the work has started |
| KIP-380 | KAFKA-7283 | "The optimization (KAFKA-7283) is currently blocked by this KIP" | Resolved | Real disagreement: the page, last edited in 2018, still says blocked |
| KIP-515 | KAFKA-8634 | "Since the merge KAFKA-8634 (...) ... AK 2.4 ultimately shipped with ZooKeeper version 3.5.6" | fix version 2.4.0 | Misreading: 3.5.6 is a ZooKeeper version in the same sentence, not the work item's release |
| KIP-906 | KAFKA-14525 | "The tools migration effort is ongoing and being tracked in KAFKA-14525" | Open | Debatable: Apache projects leave active work in "Open", so "ongoing" and "Open" can both be right |

So 3 of the 5 flags are real, 1 is a misreading and 1 depends on how a project uses its workflow.
The misreading shows a limit of the sentence rule: a version number in a sentence that names one work item
is taken as that work item's release, even when the sentence says the number belongs to something else.
It has not been fixed, so that this check stays a held-out check.

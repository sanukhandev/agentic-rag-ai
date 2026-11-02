# Test summary

| Suite | Result |
|---|---|
| Node API | 373 passed, 12 skipped |
| Focused v2 Node | 58 passed |
| Python model gateway | 37 passed |
| Full Python repository | 81 passed, 3 unrelated failures |
| Typecheck | passed |
| Lint | passed |
| Compose validation | passed |
| Azure HTTP UAT | 31/31 assertions; 21/23 model acceptance |
| Mock HTTP UAT | 39/39 assertions |
| Security HTTP regression | 9/9 |

The three full-Python failures are the pre-existing workflow fixture mismatch
and two ingestion tests that import missing `bs4`; they are outside the
conversation recovery change.

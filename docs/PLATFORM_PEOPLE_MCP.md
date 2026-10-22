# Platform people and MCP space creation

The **People** navigation section lists registered Expense Tracker users. It includes you, supports literal name search and database pagination (10, 20 or 50 per UI page), and never displays email addresses or Firebase identifiers. Select up to 50 other people across pages and choose **New space** to continue the existing space onboarding with them selected. You are always included as owner.

The authenticated API is `GET /api/people/directory/page?search=&limit=20&offset=0` (maximum limit 200). Its response is `{ people: [{ id, name }], total, limit, offset }`; `total` covers every match. Names sort case-insensitively with the app ID as a stable tie-breaker. Search treats `%` and `_` literally and also accepts a complete app user ID. Invited placeholders who have never signed in are excluded. The old `/people/directory` response remains compatible with existing pickers.

## MCP tools

Refresh the tool catalog after deployment; the server now exposes **11 tools**.

- `list_people`: optional `search`, `limit` (default 20, maximum 200), `offset`. Returns only registered display names and app IDs, with pagination guidance. The caller is marked `(you)`.
- `create_space`: required `name`; optional `kind` (`recurring`, the default, or `one_time`), `members` (up to 50 names/app IDs), and UUID `request_id`. The caller is automatically included as owner. All requested members must resolve to registered platform users before creation; an unknown or ambiguous name prevents the whole creation. Explicit app IDs disambiguate names. No email invitation or placeholder is created through this tool.

Examples:

> Show people on Expense Tracker whose name contains Bala.

> Create a one-time space called Goa weekend with Bala and Chen. Include me as owner.

> Create a monthly space called Flat groceries with Asha and Bala, then add ₹900 groceries that I paid, split equally between everyone.

Use a fresh request ID for every intended creation. Retrying with the **same ID and resolved name/kind/member set** returns the same space; member order and duplicate aliases do not create another space. Without an ID, repeated calls intentionally create separate spaces. Preserve the originally resolved member IDs when retrying after a profile rename. Identically named spaces are allowed.

The space POST now accepts an optional client-generated `id`; existing clients may omit it. A repeated ID never changes existing membership/groups and can only be retrieved by its original creator while they remain an active member. This uses the existing UUID primary key and transaction; no migration is needed. Existing owner-only permissions for changing a space's membership/settings remain in effect.

## Verification scenarios

Use disposable users/spaces. Refresh the app after MCP writes because it caches space lists.

| Case | Prompt or action | Expected |
|---|---|---|
| People page | Open People, search a name, change page size and move next/previous | Correct stable pages, matching total, no emails or authentication IDs |
| Privacy | Inspect the directory API and `list_people` outputs | Only names/app IDs; no placeholder, email or Firebase UID |
| Cross-page selection | Select a person on page 1 and page 2, then create a space | Both selected in onboarding; caller included automatically |
| Search selection | Select a person, search for someone else, select them | Earlier choice retained; Clear selection removes all choices |
| Empty search | Search for a nonexistent name | Useful empty state; clear search restores directory |
| Directory permissions | Call without sign-in, then with a personal key | 401 without credentials; valid key can browse names |
| Monthly creation | Create a monthly space with two registered strangers | Three members including caller; caller owner, others members |
| One-time creation | Create a one-time trip with Bala | Correct kind and two members; visible to Bala |
| Solo creation | Create a space without other people | Caller only, as owner |
| Ambiguous/unknown person | Create with an ambiguous first name or nonexistent person | Clarify/error; no space, membership or placeholders created |
| App ID | Create using IDs from `list_people` | Exact intended users, no email needed |
| Retry | Same UUID and same members in reverse order | Same space ID, only one space |
| New intent | Same name with a new request ID | Separate space; no accidental deduplication by name |
| Atomic failure | Include one valid registered user and one placeholder ID | Nothing created |
| Ownership | Another member tries changing settings | Existing owner-only checks still apply |
| Workflow | Create space then add an expense to the returned ID | Expense saved to that new space, correct shares |
| Small screens | Open at 375 px and laptop default zoom, in light/dark | Search, paging, selection and create controls usable without horizontal overflow |

Local automated verification uses the existing suite plus a disposable SDK/API harness, without adding tracked test files. The one existing tool-catalog assertion was updated with user approval.

## Local verification — 22 October 2026

- TypeScript, all 86 existing tests and the production build pass.
- 35 disposable API/MCP checks cover pagination and totals, literal search, response privacy, authentication, the 11-tool catalog, registered-user resolution, ambiguity, atomic failure, owner permissions, retries and creating an expense in the new space.
- 10 isolated headless Chrome checks cover cross-page/search selection, onboarding, persisted memberships, laptop (1366 × 768) and phone (375 × 812) layouts in light/dark, and browser runtime errors.
- Browser test data was kept in a separate in-memory database; the user's local app data was not populated with fixture users or test spaces.
- Live ChatGPT/Claude execution of the new tools and production deployment remain unverified; refresh the connector catalog after deployment.

# Firestore Schema — Collaborative Pāli–Sinhala Dictionary

Cloud Firestore data model for `dictionary.suththa.org`.
All collection/field names are English (code-level); the UI is Sinhala.

## Collections

### `users` — one doc per Firebase Auth UID
| field | type | notes |
|---|---|---|
| `email` | string | |
| `displayName` | string | |
| `role` | string | `"admin"` \| `"editor"` \| `"reviewer"`. Public users have no doc. |
| `active` | bool | disabled accounts blocked by rules |
| `createdBy` | string (uid) | |
| `createdAt` | timestamp | |
| `lastLoginAt` | timestamp | |

### `words` — one doc per dictionary entry (Pāli headword)
Doc id: `'w_' + sha256(headwordNorm)[:16]` (stable, import-idempotent).
| field | type | notes |
|---|---|---|
| `headword` | string | canonical Pāli roman |
| `headwordSi` | string | Sinhala-script form (optional) |
| `headwordNorm` | string | lowercase, diacritics stripped |
| `status` | string | `published` · `uncompleted` · `needs_review` · `draft` · `pending` · `rejected` · `merged` · `deleted` |
| `version` | int | bumped on each approved/recorded change |
| `isPublished` | bool | true when publicly searchable |
| `mergedInto` | string \| null | wordId when merged |
| `createdBy` / `createdAt` | | |
| `updatedBy` / `updatedAt` | | |

### `wordMeanings` — one doc per Sinhala meaning
| field | type | notes |
|---|---|---|
| `wordId` | string | |
| `si` | string | Sinhala meaning text |
| `siNorm` | string | NFC-normalized searchable form |
| `grammar` | map | `{ pos, gender, number, case, declension, notes }` |
| `sourceId` | string \| null | reference to `sources` |
| `order` | int | display order |
| `status` | string | mirrors word status |
| `createdBy/At` · `updatedBy/At` | | |

### `wordForms` — Pāli forms (dhammo, dhammaṃ, dhamme, dhammā…)
| field | type | notes |
|---|---|---|
| `wordId` | string | |
| `form` | string | Pāli form |
| `formNorm` | string | normalized |
| `type` | string | `alternative` \| `inflection` \| `derived` |
| `order` | int | |

### `examples`
| field | type | notes |
|---|---|---|
| `wordId` | string | |
| `meaningId` | string \| null | optional link |
| `pali` | string | |
| `si` | string | |
| `translationSi` | string | optional |
| `sourceId` | string \| null | |
| `order` | int | |

### `sources` — reference dictionaries
`name`, `shortName`, `description`, `url`. (e.g. සුමංගල, බුද්ධදත්ත, DPD)

### `submissions` — proposed create/edit
| field | type | notes |
|---|---|---|
| `wordId` | string | |
| `type` | string | `create` \| `edit` |
| `status` | string | `draft` · `pending` · `approved` · `rejected` |
| `before` | map | snapshot of changed fields pre-edit |
| `after` | map | proposed changes |
| `submittedBy` / `submittedAt` | | |
| `reviewedBy` / `reviewedAt` | | |
| `reviewNote` | string | rejection/request reason |

### `reviews` — append-only action log
`submissionId`, `wordId`, `reviewerId`, `action` (`approve` \| `reject` \| `request_changes`), `note`, `createdAt`.

### `versions` — immutable history
| field | type | notes |
|---|---|---|
| `wordId` | string | |
| `version` | int | |
| `action` | string | `create` · `edit` · `approve` · `reject` · `restore` · `merge` · `delete` · `publish` |
| `snapshot` | map | full word state at that version |
| `authorId` / `authorRole` | | |
| `submissionId` | string \| null | |
| `createdAt` | timestamp | |

Never overwritten — always append a new doc.

### `searchIndex` — denormalized search row per word
| field | type | notes |
|---|---|---|
| `wordId` | string | |
| `pali` | string | normalized headword |
| `paliPrefix` | string | prefix-search key (Pāli) |
| `si` | string | normalized first meaning (Sinhala prefix search) |
| `siAll` | array | tokens of all meanings |
| `slAll` | array | Singlish tokens/aliases |
| `all` | array | unique combined tokens |
| `sources` | array | source shortNames |

## Search mapping

| input | query | collection | field |
|---|---|---|---|
| Pāli prefix | range `paliPrefix >= q` and `< q+\uf8ff` | searchIndex | `paliPrefix` |
| Singlish alias | `array-contains` | searchIndex | `slAll` |
| Sinhala prefix | range | searchIndex | `si` |
| Sinhala meaning | `array-contains` | searchIndex | `siAll` |

Fallback (few results): broader range query + client-side contains filter.

## Indexes
- Single-field range/array queries require no composite indexes.
- `firestore.indexes.json` is currently empty; composite indexes will be added if combined-field queries are introduced in later phases.

## Roles (enforced in `firestore.rules`)

| action | public | editor | reviewer | admin |
|---|---|---|---|---|
| read published words + index | ✅ | ✅ | ✅ | ✅ |
| create draft / submit | | ✅ | | ✅ |
| approve / reject / request changes | | | ✅ | ✅ |
| edit own drafts | | ✅ | | ✅ |
| manage users / roles | | | | ✅ |
| merge / delete / restore | | | | ✅ |

**Self-role-change prevention**: `/users/{uid}` requires `isAdmin()` for all writes. Clients cannot modify their own role. Only admins (via `manage_users.py`) set roles.

**Immutability**: `versions` and `reviews` documents have `allow update: if false` — append-only, never overwritten.

Rules never trust the frontend — every privileged write checks `users/{uid}.active` + `role`.

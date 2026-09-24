# Finance document access and appointment authority

This change addresses AUTH-01, AUTH-02, AUTH-03 and ORG-01. It is a database migration plus isolated tests; it does not itself establish production deployment or successful real-employee OAuth/browser sessions.

## Authority

- Canonical applicant IDs take precedence over legacy profile IDs, emails and display names. Emails are considered only without an ID, and names only without either. A legacy name must uniquely identify the current active, verified caller across all Finance users in the tenant, including inactive namesakes.
- Explicit step IDs never fall through to role/name matches. Actual completed actors and action logs are evaluated separately from the assigned person, preserving uniquely identifiable historical actions. Pending labels are not completed actions.
- Unassigned role queues require the caller's department and legal entity. Existing explicit accounting, procurement and HR business permissions remain in their parent guards.
- Organization manager/director projections require `can_approve` on that exact appointment. A second appointment in another department cannot activate an unchecked appointment.

## Attachment bindings

The previous claimed-attachment rule allowed any verified employee in the tenant to read metadata and Storage objects. The replacement resolves only sealed source internal IDs and then reads the source under the caller's actual RLS. It retains restrictive HR salary policies.

The migration captures trusted existing record keys. Multiple invoice/bill rows are accepted only as one batch with identical company, department and applicant scope. When no key matches, a one-time exact-path association can preserve a uniquely scoped historical source/batch. Ambiguous candidates remain unresolved. Existing valid archive links remain usable even when a file is no longer present in the latest editable JSON.

`private.finance_legacy_attachment_links_v1` is append-only, has forced RLS and grants no direct table access to browser or service roles. The dedicated, non-API `finance_attachment_private` schema permits authenticated callers only to resolve exact scoped link parameters; it returns internal IDs, never attachment paths or document contents. The outer reader still applies parent RLS. No privileges on the older `private` namespace are broadened.

The original claim trigger retains its verified Google identity, uploader, Storage owner, exact path and atomic-write checks. When it actually promotes a staged upload, it also seals the source ID. A shared batch proof can attach to another internal ID only with the same sealed company/department/applicant/batch scope, the same uploader and Storage owner, and existing source read authority. Editing `files`, `note.batchNo`, `no` or `batch_id` cannot create read access to somebody else's claimed file.

Source IDs cannot be renamed or reused after a linked source is deleted. Normal same-ID UPSERT remains supported. A `(record_type,parent_key)` index supports this guard without scanning the entire link table on every new application.

## Historical data observed read-only

Catalog and aggregate-only queries on 2026-09-22 showed:

- 571 expense requests have both canonical and profile IDs; 4 differ. The canonical applicant ID wins.
- All 4,981 expense, 4,219 bill and 7,911 invoice step rows have an assigned `uid`.
- Claimed metadata: 2,981 expense attachments, 152 invoice attachments and 5 `storage_orphans` rows.
- 45 expense and 46 invoice attachments have no matching current ID/no/batch key. Of the latter 46, 35 have exact paths on invoices belonging to one batch each. The other 45 expense plus 11 invoice rows had no matching `path`, `storagePath` or `storage_path` in the inspected source attachment fields. They have not been guessed, relinked or deleted.
- Those 35 single-batch matches are candidate recovery evidence, not a promise that every row will pass the final company/department/applicant consistency requirement. The final migration and canary report actual mapped/unresolved counts. No production migration or operational repair was run by this implementation task.

The release canary reports aggregate `attachment_parent_link_health` alongside its unchanged strict success marker. Unresolved historical metadata needs a separate authorized source/evidence review; it must not regain tenant-wide visibility.

## Validation

Run `node scripts/test_finance_document_access_v1.cjs`. Its 78 checks use real authority SQL, verified fictional Google identities, authenticated RLS, Storage selection, the real attachment promotion trigger, and real HR reader/scope functions. Cases include same names, explicit assignment, local/foreign queues, legacy actions, malformed steps, inactive/unverified identities, tenant/environment isolation, archive preservation, ambiguity, immutable metadata, alias/path edits, ordinary and accounting uploads, temporary-to-canonical upload IDs, shared batches, foreign upload rejection, HR positive/negative scope, source-ID tombstones, organization appointments, full postflight/canary execution, and guard-drift rejection.

The fixture is isolated PGlite; no production employee claims, tokens, file contents, messages, payments or approvals are used. Existing organization, Google identity, current identity and HR posting suites should also pass. Production latency, real browser download and employee OAuth acceptance still require the protected release and live authorized checks.

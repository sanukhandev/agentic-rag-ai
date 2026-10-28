# ANCFZ knowledge-source conflict report

Generated from the local PostgreSQL knowledge store on 2026-10-28. This is a review report, not an approval decision.

## Inventory

- Tenant: `anc` (tenant id `d432b965-6862-49b6-abbc-882284ffa1d0`)
- Active public sources: 1
- Active chunks: 2,057
- Approval status: the supplied archive records are marked pending business validation; no record was promoted by this work.

## Conflicts and review items

1. Package pricing is repeated in several generated/descriptive sections and includes multiple representations of the same visa tiers (for example 0, 1, 3 and 5 visas). Other sections describe a 10-visa ceiling and a starting price. These statements need one authoritative, dated rate card before the assistant may quote a commercial price.
2. The source text contains operational claims such as license issuance “in as little as 2 hours” and package inclusions/exclusions. These are commercial/regulatory claims and require owner approval and an effective date.
3. The source content contains its own review instructions (“confirm source owner”, “validate prices, inclusions, visa and registration timelines”), so it is not evidence that those claims have already been approved.
4. The current catalog's document policy for `anc.setup.new_company` allows business documents only. Passport and Emirates ID are not currently configured as allowed document types, and personal identity documents are disabled by default.

## Runtime decision

The API now fails closed when retrieved evidence conflicts, returning a cited review/uncertainty response rather than choosing a price. Until a business-approved, versioned package source is published, the agent must not present a verified price, eligibility promise, or guaranteed timeline.

## Required approval action

Publish a tenant-approved rate card and document policy with source owner, effective dates, package identifiers, inclusions/exclusions, visa tiers, workspace variants, and review expiry. Then re-run retrieval and grounding evaluation before enabling commercial confirmation or identity-document collection.

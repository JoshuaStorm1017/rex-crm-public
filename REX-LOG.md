# Rex log

## 2026-10-11 13:44 EDT

Closed the five product-catalog mutations the review said still survived. The checks were already in the domain and the server actions. The tests never reached them, so a price over the cap, a price update that rewrote every standard price, a product count that ignored the organization, float rounding of `$1,250.50` and `1.005`, and a delete action that skipped the delete all stayed green.

The new assertions fail when those lines are removed. I applied each mutation, watched the focused suite fail, and restored the code. `npm run verify` exited 0 at 13:44 EDT: 34 files, 402 tests, Next.js 16.3.5 build. No UI change, so the earlier browser pass was not repeated.

Next: opportunity line items on the standard price, then a custom price book. Do not retry the whole sharing model in one change. Undelete, opportunity contact roles, Change Owner, and Edit/Delete visibility on the other objects are still open.

## 2026-10-11 13:07 EDT

Shipped a product catalog with one standard price book per organization. The previous session tried to land organization-wide defaults, the role hierarchy, and criteria sharing rules together. That change was abandoned after three review rounds, so this session took a smaller piece: the catalog Salesforce needs before quotes.

A product has a name, code, family, description, and active flag. Its standard price is a price book entry stored as integer cents. `19.99` is 1999. The same code can exist in two orgs and cannot be reused on a live product in one org. Reads and writes use the existing profile and owner checks. Riley can see the operator's product and cannot edit it.

`npm run verify` exited 0 at 13:04 EDT: 34 files, 398 tests, Next.js 16.3.5 build. A form pass on a throwaway database at port 3017 created Anvil at `$19.99`, kept Riley from editing it, and rejected a three-decimal price. Chrome DevTools was not connected, so there was no viewport pass. The dev server was stopped.

Next: opportunity line items on the standard price, then a custom price book. Do not retry the whole sharing model in one change. Undelete, opportunity contact roles, Change Owner, and Edit/Delete visibility on the other objects are still open.

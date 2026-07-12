# Accept Eventual Convergence over Gist

GitHub Gist does not provide a documented compare-and-swap update for PATCH, so Tabstow cannot promise linearizable cross-device writes. Reconciliation will read, merge, conditionally skip unchanged writes, PATCH, read back to verify, and retry with jitter when another writer wins; durable local revisions and Deletion Markers let subsequent reconciliations restore a temporarily overwritten change. The product therefore promises Eventual Convergence after successful future synchronization, not immediate atomic cloud consistency.

# Merge local and remote data on first connection

The first synchronization after a device connects to GitHub will non-destructively merge local synchronized data with the selected Sync Gist, then persist the converged result on both sides. Neither side replaces the other wholesale, so pre-connection local items and remote-only items are retained; device-local History is excluded.

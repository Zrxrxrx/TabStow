# Make manual synchronization non-destructive

The Settings-only Manual Pull and Manual Push actions will use the same entity-version merge rules as automatic synchronization. Pull reads and safely merges without writing remotely, while Push reads the latest remote state before writing the converged result; neither action exposes a force-local or force-remote replacement mode. A non-empty invalid Sync File pauses synchronization and offers Open Gist, Retry, or Choose Another Gist, never a destructive local overwrite.

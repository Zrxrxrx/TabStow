# Schedule synchronization from every mutation entrypoint

Every Sync-relevant Mutation will persist locally, mark Pending Synchronization, and reset the shared 60-second quiet-period schedule regardless of whether it came from the New Tab, toolbar action, context menu, History Restore, Quick Links, or Settings. A single background coordinator owns serialization and retry, while the New Tab contributes open and focus reconciliation triggers plus user-visible status rather than serving as the only synchronization runtime.

# Tabstow

Tabstow organizes browser tabs into active browser state and durable saved state for later use.

## Saved tabs

**Saved for Later**:
The set of Tab Sessions retained for future reopening and eligible for cross-device synchronization.
_Avoid_: Tag, label, archive

**Tab Session**:
An ordered group of Saved Tabs captured together.
_Avoid_: Tag group, bookmark folder

**Saved Tab**:
A page retained in Saved for Later and associated with one Tab Session. It synchronizes independently from other Saved Tabs in that session.
_Avoid_: Bookmark, live tab

**Quick Link**:
A user-curated shortcut synchronized as an independent entity, except that an uploaded image icon remains Device-local State.
_Avoid_: Saved Tab, bookmark

**Saved Order**:
The synchronized relative ordering of Tab Sessions and of Saved Tabs within a session.
_Avoid_: Local sort, creation order

**History**:
The device-local recycle bin for items removed from Saved for Later through opening, restoration, or deletion.
_Avoid_: Synced archive

## Synchronization

**Full-lifecycle synchronization**:
Cross-device convergence of Saved for Later across creation, editing, ordering, movement, consumption, restoration, and deletion. It describes synchronized outcomes, not network-request frequency.
_Avoid_: Sync every action, push every click

**Automatic synchronization**:
Reconciliation initiated by Tabstow without an explicit Pull or Push action; multiple local changes may be batched into one remote update.
_Avoid_: Continuous real-time sync, per-action push

**Eventual Convergence**:
The guarantee that connected replicas reach the same Synchronized State after subsequent successful reconciliations, without promising an atomic or immediately consistent remote write.
_Avoid_: Real-time consistency, transactional cloud save

**Synchronized State**:
Saved for Later, Quick Links, and the tab-behavior preferences shared between connected devices through the Sync File.
_Avoid_: Account data, all settings

**Pending Synchronization**:
Locally durable changes that have not yet been confirmed in the Sync File and remain eligible for automatic retry.
_Avoid_: Unsaved data, failed changes

**Sync-relevant Mutation**:
Any local change to Synchronized State, regardless of whether it originated in the New Tab, toolbar, context menu, History, or Settings.
_Avoid_: New Tab action, manual sync

**Synchronization Paused**:
A condition that requires user action before synchronization can continue, while local data and local operations remain available.
_Avoid_: Data loss, application failure

**Device-local State**:
State that intentionally remains owned by one device, including GitHub authorization, Sync Gist configuration, Replica ID, History, Todos, theme, and language.
_Avoid_: Unsynced data, pending data

**Quiet-period synchronization**:
Automatic synchronization performed after sync-relevant local activity has stopped for a defined interval. Pending work remains eligible for background completion after the New Tab closes.
_Avoid_: Per-action push, periodic polling

**Manual Pull**:
A user-triggered read, validation, and safe merge of the Sync File into local Synchronized State without replacing newer local entities or writing remotely.
_Avoid_: Remote restore, force pull

**Manual Push**:
A user-triggered reconciliation that first reads and merges the latest Sync File, then writes the converged Synchronized State.
_Avoid_: Local overwrite, force push

**GitHub Connection**:
The per-device authorization that lets Tabstow access the user's synchronization Gist through GitHub OAuth Device Flow.
_Avoid_: GitHub login, pasted token

**Disconnect**:
The local end of a GitHub Connection, which removes authorization and Sync Gist binding while preserving user data and leaving the remote Gist unchanged.
_Avoid_: Revoke, delete account, clear data

**Connection Confirmation**:
The user's approval to merge existing local Synchronized State into the newly authorized GitHub account's Sync Gist. It is unnecessary when the local synchronized state is empty.
_Avoid_: OAuth consent, sync confirmation

**Sync Gist**:
The pre-existing GitHub Gist that contains the Sync File. Tabstow discovers it automatically when exactly one valid candidate exists, otherwise the user selects or identifies it; Tabstow never creates it.
_Avoid_: Managed Gist, auto-created Gist

**Gist Binding**:
The Device-local State that associates a GitHub Connection with one exact Gist ID and Sync File name until the user explicitly changes it.
_Avoid_: Discovery result, active candidate

**Sync File**:
The file inside the Sync Gist that contains Tabstow's synchronization document. Its canonical filename is `tabstow.sync.json`, while a manually selected Gist may use an explicitly configured filename.
_Avoid_: Gist payload

**Sync File Migration**:
The one-time import of version-one Sync File data into the version-two model before the file is permanently rewritten as version two.
_Avoid_: Backward compatibility, dual write

**Initial Reconciliation**:
The first synchronization after a GitHub Connection, where local and remote synchronized data are merged without treating either side as a complete replacement. History remains outside the reconciliation.
_Avoid_: Initial pull, remote restore

**Sync Entity**:
An independently versioned piece of synchronized state that can be merged without replacing unrelated entities.
_Avoid_: Sync object, document row

**Replica ID**:
An opaque per-installation identifier owned locally and included only in entity revisions to make conflict resolution deterministic; remote data never replaces it.
_Avoid_: GitHub account ID, device profile

**Deletion Marker**:
A versioned statement that a Sync Entity was removed, retained so an older device cannot reintroduce it.
_Avoid_: History entry, hard delete

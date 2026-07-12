# Confirm before merging local data into an account

After Device Flow identifies the authorized GitHub account, Tabstow will require Connection Confirmation before merging any existing local Synchronized State into that account's Sync Gist. The same confirmation is required before changing account or Gist Binding. Cancellation leaves the current connection or disconnected state and local data unchanged, while an empty local synchronized state can initialize from the Gist without confirmation; this prevents an accidental target change from silently uploading browsing data.

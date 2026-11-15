### 1. [high] Upgrade snapshot replacement is not implementable as written
Section 12 says `VACUUM INTO` must replace `/data/pre-upgrade.db`, but SQLite requires the destination to be absent or empty, so the second migration snapshot can fail. Require snapshotting to a new temporary file on `/data`, closing and verifying it, then atomically renaming it over the old snapshot; remove stale temporary files after failure.

### 2. [high] Quota and agent-rate checks are not race-safe
Sections 6.6 and 8.3 require limits but not serialization between checking and committing. Concurrent saves, uploads, or agent calls can exceed quota or the hourly cap. Require quota validation plus note/image accounting—and agent rate check, increment, note/tag/FTS creation—to run in one `BEGIN IMMEDIATE` transaction; define filesystem cleanup when database commit fails.

### 3. [high] Magic-byte checks accept malformed images
Section 6.5 detects formats only from magic bytes, while section 13.10 requires rejecting files that are not real images. Add complete format decoding/validation after signature detection, with decoded-pixel and frame limits to prevent decompression bombs. Reject malformed or undecodable uploads before storing their files or inserting database rows.

### 4. [medium] Image upload ownership and failure handling are undefined
Section 6.5 never defines how an upload is associated with its note before the editor saves the returned image reference. Specify `POST /api/notes/<id>/images`, restricted to an existing, non-trashed note owned by the user, and define the returned id/src. Require temporary-file cleanup and deletion of any stored file whose database-row insertion fails.

### 5. [medium] Argon2id security parameters are left to defaults
Section 5 names Argon2id but leaves its cost, salt and output parameters to library defaults, making security and login latency deployment-dependent. Specify Argon2 version 1.3, 64 MiB memory, three iterations, parallelism one, a fresh 16-byte random salt and 32-byte output; store standard encoded hashes containing those parameters.

VERDICT: NOT READY — Resolve the migration, write-integrity and image-validation defects before building.
END-OF-REVIEW
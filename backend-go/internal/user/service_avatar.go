package user

import (
	"context"
	"fmt"
	"time"
)

// UploadAvatar mirrors UserService.uploadAvatar.
//
// TODO(gap): this does not upload anything anywhere -- it fabricates an
// S3-shaped URL from config and writes that fake URL to the DB, returning
// a real success response. The original has an explicit
// "// TODO: Implement actual S3 upload" comment in user.service.ts and
// never constructs an S3 client despite reading STORAGE_* config for one.
// Faithfully ported as-is, see backend/services/user-service/AGENTS.md.
// This also means this method itself never needs the uploaded file's
// actual bytes -- the original reads the file into a buffer only to
// immediately discard it (`const buffer = await file.toBuffer()`, never
// referenced again) -- so this signature only takes the file extension,
// not file content. The caller (Handler.UploadAvatar) still reads and
// discards the bytes before calling this, though: that read is what lets
// http.MaxBytesReader's size cap fire at all (see routes.go's
// avatarUploadMaxBytes and handler.go's comment on the same drain) --
// "discard" is not "skip reading".
func (s *Service) UploadAvatar(ctx context.Context, userID, fileExtension string) (string, error) {
	fileName := fmt.Sprintf("%s-%d.%s", userID, time.Now().UnixNano(), fileExtension)
	url := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/avatars/%s", s.cfg.StorageBucket, s.cfg.StorageRegion, fileName)

	if err := s.store.UpdateProfilePicture(ctx, userID, url); err != nil {
		return "", err
	}
	return url, nil
}

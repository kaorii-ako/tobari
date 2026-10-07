#ifndef TOBARI_BLOCKER_H_
#define TOBARI_BLOCKER_H_

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

void* tobari_blocker_new(const char* const* list_paths, size_t count);
void tobari_blocker_free(void* handle);
size_t tobari_blocker_rule_count(const void* handle);
int tobari_blocker_should_block(const void* handle,
                                const char* url,
                                const char* source_url,
                                const char* request_type,
                                const char* method);
size_t tobari_registrable_domain(const char* host, char* out, size_t cap);

/* Import from another browser; returns JSON to release with tobari_free_string. */
char* tobari_import(const char* op, const char* arg);
void tobari_free_string(char* s);

/* SHA-256 of a file, hex, into out[65]. Returns 1 on success. */
int tobari_sha256_file(const char* path, char* out);

#ifdef __cplusplus
}
#endif

#endif

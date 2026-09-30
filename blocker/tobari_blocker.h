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

#ifdef __cplusplus
}
#endif

#endif

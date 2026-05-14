#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class WNRemoteServer;

@interface WNNativeLogCapture : NSObject

+ (instancetype)shared;

/// Phase 1: redirect stderr and start writing to JSONL file.
/// Call as early as possible (e.g. in __attribute__((constructor))).
/// Only activates if NSUserDefaults indicates native log was previously enabled.
- (void)beginCapture;

/// Phase 2: attach the remote server for live push and flush buffered entries.
- (void)attachServer:(WNRemoteServer *)server;

- (void)setEnabled:(BOOL)enabled;
@property (nonatomic, readonly) BOOL isEnabled;

/// Called by WNRemoteServer when first client connects / last client disconnects.
- (void)clientDidConnect;
- (void)clientDidDisconnect;

/// RPC: list all native log session files on device.
- (NSArray<NSDictionary *> *)listSessions;

/// RPC: read entries from a session file starting at byte offset.
- (NSDictionary *)readSession:(NSString *)filename offset:(unsigned long long)offset limit:(NSUInteger)limit;

/// RPC: delete a historical session file (cannot delete the active file).
- (BOOL)deleteSession:(NSString *)filename;

@end

NS_ASSUME_NONNULL_END

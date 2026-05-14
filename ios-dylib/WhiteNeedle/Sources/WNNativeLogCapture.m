#import "WNNativeLogCapture.h"
#import "WNRemoteServer.h"
#import <fcntl.h>
#import <unistd.h>

static NSString *const kLogPrefix    = @"[WhiteNeedle:NativeLog]";
static NSString *const kDefaultsKey  = @"WNNativeLogCaptureEnabled";
static const NSTimeInterval kMaxSessionAge = 7 * 24 * 3600;

static void wn_write_all(int fd, const void *buf, size_t len) {
    const uint8_t *p = (const uint8_t *)buf;
    while (len > 0) {
        ssize_t n = write(fd, p, len);
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }
        p   += n;
        len -= (size_t)n;
    }
}

#pragma mark - Private interface

@interface WNNativeLogCapture () {
    int _pipeFds[2];
}

@property (nonatomic, weak)   WNRemoteServer *server;
@property (nonatomic, assign) BOOL capturing;
@property (nonatomic, assign) int  originalStderrFd;
@property (nonatomic, strong) dispatch_source_t readSource;
@property (nonatomic, strong) NSMutableString  *lineBuffer;
@property (nonatomic, strong) NSMutableData    *rawTail;

@property (nonatomic, strong) dispatch_queue_t logQueue;
@property (nonatomic, copy)   NSString *logDir;
@property (nonatomic, copy)   NSString *currentLogFile;
@property (nonatomic, assign) int  logFileFd;
@property (nonatomic, assign) unsigned long long writeOffset;
@property (nonatomic, assign) unsigned long long flushedOffset;
@property (nonatomic, assign) BOOL clientConnected;
@property (nonatomic, assign) BOOL flushing;

@end

@implementation WNNativeLogCapture

#pragma mark - Singleton

+ (instancetype)shared {
    static WNNativeLogCapture *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[WNNativeLogCapture alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _capturing       = NO;
        _originalStderrFd = -1;
        _logFileFd       = -1;
        _writeOffset     = 0;
        _flushedOffset   = 0;
        _clientConnected = NO;
        _flushing        = NO;
        _logQueue = dispatch_queue_create("com.whiteneedle.nativelog", DISPATCH_QUEUE_SERIAL);
        [self ensureLogDirectory];
    }
    return self;
}

- (void)ensureLogDirectory {
    NSString *lib = NSSearchPathForDirectoriesInDomains(NSLibraryDirectory, NSUserDomainMask, YES).firstObject;
    self.logDir = [lib stringByAppendingPathComponent:@"wn_logs"];
    [[NSFileManager defaultManager] createDirectoryAtPath:self.logDir
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];
}

#pragma mark - Two-phase lifecycle

- (void)beginCapture {
    if ([[NSUserDefaults standardUserDefaults] boolForKey:kDefaultsKey]) {
        [self startCapture];
    }
}

- (void)attachServer:(WNRemoteServer *)server {
    self.server = server;
}

- (BOOL)isEnabled {
    return self.capturing;
}

- (void)setEnabled:(BOOL)enabled {
    [[NSUserDefaults standardUserDefaults] setBool:enabled forKey:kDefaultsKey];
    [[NSUserDefaults standardUserDefaults] synchronize];

    if (enabled && !self.capturing) {
        [self startCapture];
        dispatch_async(self.logQueue, ^{
            if (self.clientConnected && self.capturing) {
                [self flushOnQueue];
            }
        });
    } else if (!enabled && self.capturing) {
        [self stopCapture];
    }
}

#pragma mark - Client lifecycle (called by WNRemoteServer)

- (void)clientDidConnect {
    dispatch_async(self.logQueue, ^{
        BOOL wasConnected = self.clientConnected;
        self.clientConnected = YES;
        if (!wasConnected && self.capturing) {
            [self flushOnQueue];
        }
    });
}

- (void)clientDidDisconnect {
    dispatch_async(self.logQueue, ^{
        self.clientConnected = NO;
        self.flushing = NO;
    });
}

#pragma mark - JSONL file I/O

- (void)openLogFile {
    if (self.logFileFd >= 0) return;

    NSDateFormatter *fmt = [[NSDateFormatter alloc] init];
    fmt.dateFormat = @"yyyy-MM-dd-HHmmss";
    fmt.timeZone  = [NSTimeZone localTimeZone];
    NSString *name = [NSString stringWithFormat:@"nativelog-%@.jsonl", [fmt stringFromDate:[NSDate date]]];
    self.currentLogFile = [self.logDir stringByAppendingPathComponent:name];

    self.logFileFd = open(self.currentLogFile.UTF8String, O_WRONLY | O_CREAT | O_APPEND, 0644);
    self.writeOffset   = 0;
    self.flushedOffset = 0;

    if (self.logFileFd < 0) {
        int fd = self.originalStderrFd >= 0 ? self.originalStderrFd : STDERR_FILENO;
        dprintf(fd, "%s Failed to open log file: %s\n", kLogPrefix.UTF8String, self.currentLogFile.UTF8String);
    }
}

- (void)writeEntryToFile:(NSDictionary *)entry {
    if (self.logFileFd < 0) return;

    NSData *json = [NSJSONSerialization dataWithJSONObject:entry options:0 error:nil];
    if (!json) return;

    NSMutableData *line = [json mutableCopy];
    static const char nl = '\n';
    [line appendBytes:&nl length:1];

    wn_write_all(self.logFileFd, line.bytes, line.length);
    self.writeOffset += line.length;
}

#pragma mark - Flush (runs exclusively on logQueue)

- (void)flushOnQueue {
    if (!self.clientConnected || !self.capturing) return;
    if (self.logFileFd < 0) return;

    unsigned long long currentEnd = self.writeOffset;
    if (currentEnd <= self.flushedOffset) {
        return;
    }

    self.flushing = YES;

    WNRemoteServer *srv = self.server;
    if (!srv) {
        self.flushing = NO;
        return;
    }

    int readFd = open(self.currentLogFile.UTF8String, O_RDONLY);
    if (readFd < 0) {
        self.flushing = NO;
        return;
    }

    lseek(readFd, (off_t)self.flushedOffset, SEEK_SET);

    unsigned long long targetBytes = currentEnd - self.flushedOffset;
    unsigned long long bytesRead   = 0;
    unsigned long long linesBytes  = 0;
    NSMutableData *residual = [NSMutableData dataWithCapacity:4096];
    NSData *newline = [@"\n" dataUsingEncoding:NSUTF8StringEncoding];
    char buf[8192];

    while (bytesRead < targetBytes) {
        size_t toRead = MIN(sizeof(buf), (size_t)(targetBytes - bytesRead));
        ssize_t n = read(readFd, buf, toRead);
        if (n <= 0) break;
        [residual appendBytes:buf length:(NSUInteger)n];
        bytesRead += (unsigned long long)n;

        NSRange nlRange;
        while ((nlRange = [residual rangeOfData:newline options:0 range:NSMakeRange(0, residual.length)]).location != NSNotFound) {
            NSData *lineData = [residual subdataWithRange:NSMakeRange(0, nlRange.location)];
            NSUInteger consumed = nlRange.location + 1;
            [residual replaceBytesInRange:NSMakeRange(0, consumed) withBytes:NULL length:0];
            linesBytes += consumed;

            NSDictionary *entry = [NSJSONSerialization JSONObjectWithData:lineData options:0 error:nil];
            if (entry) {
                [srv broadcastNotification:@"nativeLog" params:@{
                    @"message":   entry[@"message"]   ?: @"",
                    @"level":     entry[@"level"]     ?: @"log",
                    @"timestamp": entry[@"ts"]        ?: @(0),
                    @"flushed":   @YES
                }];
            }
        }
    }

    close(readFd);
    self.flushedOffset += linesBytes;
    self.flushing = NO;

    int origFd = self.originalStderrFd >= 0 ? self.originalStderrFd : STDERR_FILENO;
    dprintf(origFd, "%s Flushed %llu bytes of buffered logs to client\n", kLogPrefix.UTF8String, linesBytes);
}

#pragma mark - Capture start / stop

- (void)startCapture {
    if (self.capturing) return;

    self.originalStderrFd = dup(STDERR_FILENO);
    if (self.originalStderrFd < 0) {
        NSLog(@"%@ Failed to dup stderr", kLogPrefix);
        return;
    }

    if (pipe(_pipeFds) != 0) {
        NSLog(@"%@ Failed to create pipe", kLogPrefix);
        close(self.originalStderrFd);
        self.originalStderrFd = -1;
        return;
    }

    if (dup2(_pipeFds[1], STDERR_FILENO) < 0) {
        NSLog(@"%@ Failed to redirect stderr", kLogPrefix);
        close(_pipeFds[0]);
        close(_pipeFds[1]);
        close(self.originalStderrFd);
        self.originalStderrFd = -1;
        return;
    }
    close(_pipeFds[1]);

    self.capturing  = YES;
    self.lineBuffer = [NSMutableString string];
    self.rawTail    = [NSMutableData data];

    [self openLogFile];

    int readFd = _pipeFds[0];
    int origFd = self.originalStderrFd;
    __weak typeof(self) weakSelf = self;

    dispatch_source_t source = dispatch_source_create(
        DISPATCH_SOURCE_TYPE_READ, readFd, 0,
        dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0)
    );

    dispatch_source_set_event_handler(source, ^{
        char rawBuf[8192];
        ssize_t n = read(readFd, rawBuf, sizeof(rawBuf) - 1);
        if (n <= 0) return;

        wn_write_all(origFd, rawBuf, (size_t)n);

        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf || !strongSelf.capturing) return;

        @synchronized (strongSelf) {
            NSMutableData *pending = strongSelf.rawTail;
            [pending appendBytes:rawBuf length:(NSUInteger)n];

            NSString *chunk = [[NSString alloc] initWithData:pending encoding:NSUTF8StringEncoding];
            if (!chunk) {
                // Incomplete multi-byte sequence at the tail; wait for more bytes.
                if (pending.length > 16) {
                    // Safety: try converting everything except the last 4 bytes (max UTF-8 sequence).
                    NSUInteger safe = pending.length - 4;
                    chunk = [[NSString alloc] initWithBytes:pending.bytes length:safe encoding:NSUTF8StringEncoding];
                    if (chunk) {
                        [pending replaceBytesInRange:NSMakeRange(0, safe) withBytes:NULL length:0];
                    }
                }
                if (!chunk) return;
            } else {
                [pending setLength:0];
            }

            [strongSelf.lineBuffer appendString:chunk];

            while (YES) {
                NSRange nlRange = [strongSelf.lineBuffer rangeOfString:@"\n"];
                if (nlRange.location == NSNotFound) break;

                NSString *line = [strongSelf.lineBuffer substringToIndex:nlRange.location];
                [strongSelf.lineBuffer deleteCharactersInRange:NSMakeRange(0, nlRange.location + 1)];

                NSString *trimmed = [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
                if (trimmed.length == 0) continue;
                if ([trimmed containsString:@"[WhiteNeedle"]) continue;

                [strongSelf processLogLine:trimmed];
            }
        }
    });

    dispatch_source_set_cancel_handler(source, ^{
        close(readFd);
    });

    dispatch_resume(source);
    self.readSource = source;

    dprintf(origFd, "%s Native log capture started (file: %s)\n",
            kLogPrefix.UTF8String, self.currentLogFile.lastPathComponent.UTF8String);

    [self cleanupOldSessions];
}

- (void)stopCapture {
    if (!self.capturing) return;
    self.capturing = NO;

    if (self.originalStderrFd >= 0) {
        dup2(self.originalStderrFd, STDERR_FILENO);
        close(self.originalStderrFd);
        self.originalStderrFd = -1;
    }

    if (self.readSource) {
        dispatch_source_cancel(self.readSource);
        self.readSource = nil;
    }

    @synchronized (self) {
        if (self.lineBuffer.length > 0) {
            NSString *remaining = [self.lineBuffer stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (remaining.length > 0 && ![remaining containsString:@"[WhiteNeedle"]) {
                [self processLogLine:remaining];
            }
            [self.lineBuffer setString:@""];
        }
        [self.rawTail setLength:0];
    }

    dispatch_async(self.logQueue, ^{
        if (self.logFileFd >= 0) {
            close(self.logFileFd);
            self.logFileFd = -1;
        }
    });

    NSLog(@"%@ Native log capture stopped", kLogPrefix);
}

#pragma mark - Log line processing

- (void)processLogLine:(NSString *)trimmed {
    NSDictionary *parsed = [self parseLogLine:trimmed];
    if (!parsed) return;

    NSString *cleaned  = parsed[@"message"];
    NSString *typeHint = parsed[@"typeHint"];

    NSString *level = @"log";
    if ([typeHint isEqualToString:@"error"] || [typeHint isEqualToString:@"fault"]) {
        level = @"error";
    } else if ([typeHint isEqualToString:@"debug"]) {
        level = @"debug";
    } else {
        NSString *lowered = [cleaned lowercaseString];
        if ([lowered containsString:@"error"] || [lowered containsString:@"fault"]) {
            level = @"error";
        } else if ([lowered containsString:@"warning"] || [lowered containsString:@"warn"]) {
            level = @"warn";
        }
    }

    NSNumber *originalTs = parsed[@"timestamp"];
    long long tsMillis;
    if (originalTs) {
        tsMillis = (long long)([originalTs doubleValue] * 1000.0);
    } else {
        tsMillis = (long long)([[NSDate date] timeIntervalSince1970] * 1000.0);
    }

    NSDictionary *entry = @{
        @"ts":      @(tsMillis),
        @"level":   level,
        @"message": cleaned
    };

    dispatch_async(self.logQueue, ^{
        [self writeEntryToFile:entry];

        if (self.clientConnected && !self.flushing) {
            WNRemoteServer *srv = self.server;
            if (srv) {
                [srv broadcastNotification:@"nativeLog" params:@{
                    @"message":   cleaned,
                    @"level":     level,
                    @"timestamp": @(tsMillis)
                }];
                self.flushedOffset = self.writeOffset;
            }
        }
    });
}

#pragma mark - OSLOG parsing

- (NSDictionary *)parseLogLine:(NSString *)line {
    if (![line hasPrefix:@"OSLOG-"]) {
        return @{@"message": line};
    }

    NSString *message    = line;
    NSString *timePrefix = @"";
    NSString *typeHint   = @"";
    NSNumber *timestamp  = nil;

    NSRange braceOpen  = [line rangeOfString:@"{"];
    NSRange braceClose = [line rangeOfString:@"}"];
    if (braceOpen.location != NSNotFound && braceClose.location != NSNotFound
        && braceClose.location > braceOpen.location) {

        NSString *meta = [line substringWithRange:NSMakeRange(braceOpen.location + 1,
                                                               braceClose.location - braceOpen.location - 1)];

        NSRange tRange = [meta rangeOfString:@"t:"];
        if (tRange.location != NSNotFound) {
            NSUInteger start = tRange.location + 2;
            NSRange commaRange = [meta rangeOfString:@"," options:0
                                               range:NSMakeRange(start, meta.length - start)];
            NSString *tStr;
            if (commaRange.location != NSNotFound) {
                tStr = [meta substringWithRange:NSMakeRange(start, commaRange.location - start)];
            } else {
                tStr = [meta substringFromIndex:start];
            }
            double ts = [tStr doubleValue];
            if (ts > 0) {
                timestamp = @(ts);
                NSDate *date = [NSDate dateWithTimeIntervalSince1970:ts];
                static NSDateFormatter *fmt;
                static dispatch_once_t onceToken;
                dispatch_once(&onceToken, ^{
                    fmt = [[NSDateFormatter alloc] init];
                    fmt.dateFormat = @"HH:mm:ss.SSS";
                    fmt.timeZone  = [NSTimeZone localTimeZone];
                });
                timePrefix = [NSString stringWithFormat:@"[%@] ", [fmt stringFromDate:date]];
            }
        }

        NSRange typeRange = [meta rangeOfString:@"type:\""];
        if (typeRange.location != NSNotFound) {
            NSUInteger start = typeRange.location + 6;
            NSRange endQuote = [meta rangeOfString:@"\"" options:0
                                             range:NSMakeRange(start, meta.length - start)];
            if (endQuote.location != NSNotFound) {
                typeHint = [[meta substringWithRange:NSMakeRange(start, endQuote.location - start)] lowercaseString];
            }
        }

        NSUInteger afterBrace = braceClose.location + 1;
        if (afterBrace < line.length) {
            message = [[line substringFromIndex:afterBrace]
                       stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        } else {
            message = @"";
        }
    }

    if (message.length == 0) return nil;

    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"message"] = [timePrefix stringByAppendingString:message];
    if (typeHint.length > 0) {
        result[@"typeHint"] = typeHint;
    }
    if (timestamp) {
        result[@"timestamp"] = timestamp;
    }
    return result;
}

#pragma mark - Session management (RPC)

- (NSArray<NSDictionary *> *)listSessions {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSArray *files = [fm contentsOfDirectoryAtPath:self.logDir error:nil];
    NSMutableArray *result = [NSMutableArray array];

    for (NSString *name in files) {
        if (![name hasSuffix:@".jsonl"]) continue;
        NSString *fullPath = [self.logDir stringByAppendingPathComponent:name];
        NSDictionary *attrs = [fm attributesOfItemAtPath:fullPath error:nil];
        if (!attrs) continue;
        [result addObject:@{
            @"filename": name,
            @"size":     attrs[NSFileSize] ?: @(0),
            @"created":  @([attrs[NSFileCreationDate] timeIntervalSince1970] * 1000.0),
            @"modified": @([attrs[NSFileModificationDate] timeIntervalSince1970] * 1000.0),
            @"isActive": @([fullPath isEqualToString:self.currentLogFile])
        }];
    }

    [result sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        return [b[@"created"] compare:a[@"created"]];
    }];
    return result;
}

- (NSDictionary *)readSession:(NSString *)filename offset:(unsigned long long)offset limit:(NSUInteger)limit {
    if (!filename || [filename containsString:@".."]) {
        return @{@"error": @"Invalid filename"};
    }

    NSString *fullPath = [self.logDir stringByAppendingPathComponent:filename];
    if (![[NSFileManager defaultManager] fileExistsAtPath:fullPath]) {
        return @{@"error": @"File not found"};
    }

    int fd = open(fullPath.UTF8String, O_RDONLY);
    if (fd < 0) return @{@"error": @"Cannot open file"};

    lseek(fd, (off_t)offset, SEEK_SET);

    NSMutableArray *entries = [NSMutableArray array];
    NSMutableData *residual = [NSMutableData dataWithCapacity:4096];
    NSData *newline = [@"\n" dataUsingEncoding:NSUTF8StringEncoding];
    char buf[8192];
    unsigned long long bytesConsumed = 0;

    while (entries.count < limit) {
        ssize_t n = read(fd, buf, sizeof(buf));
        if (n <= 0) break;
        [residual appendBytes:buf length:(NSUInteger)n];

        NSRange nlRange;
        while (entries.count < limit &&
               (nlRange = [residual rangeOfData:newline options:0 range:NSMakeRange(0, residual.length)]).location != NSNotFound) {
            NSData *lineData = [residual subdataWithRange:NSMakeRange(0, nlRange.location)];
            NSUInteger lineLen = nlRange.location + 1;
            [residual replaceBytesInRange:NSMakeRange(0, lineLen) withBytes:NULL length:0];
            bytesConsumed += lineLen;

            NSDictionary *entry = [NSJSONSerialization JSONObjectWithData:lineData options:0 error:nil];
            if (entry) {
                [entries addObject:entry];
            }
        }
    }

    close(fd);

    return @{
        @"entries":    entries,
        @"nextOffset": @(offset + bytesConsumed),
        @"hasMore":    @(residual.length > 0 || entries.count == limit)
    };
}

- (BOOL)deleteSession:(NSString *)filename {
    if (!filename || [filename containsString:@".."]) return NO;

    NSString *fullPath = [self.logDir stringByAppendingPathComponent:filename];
    if ([fullPath isEqualToString:self.currentLogFile]) return NO;

    return [[NSFileManager defaultManager] removeItemAtPath:fullPath error:nil];
}

#pragma mark - Cleanup

- (void)cleanupOldSessions {
    NSString *activeFile = self.currentLogFile;
    NSString *dir = self.logDir;
    int origFd = self.originalStderrFd >= 0 ? self.originalStderrFd : STDERR_FILENO;

    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_LOW, 0), ^{
        NSFileManager *fm = [NSFileManager defaultManager];
        NSArray *files = [fm contentsOfDirectoryAtPath:dir error:nil];
        NSDate *cutoff = [NSDate dateWithTimeIntervalSinceNow:-kMaxSessionAge];

        for (NSString *name in files) {
            if (![name hasSuffix:@".jsonl"]) continue;
            NSString *fullPath = [dir stringByAppendingPathComponent:name];
            if ([fullPath isEqualToString:activeFile]) continue;

            NSDictionary *attrs = [fm attributesOfItemAtPath:fullPath error:nil];
            NSDate *modified = attrs[NSFileModificationDate];
            if (modified && [modified compare:cutoff] == NSOrderedAscending) {
                [fm removeItemAtPath:fullPath error:nil];
                dprintf(origFd, "%s Cleaned up old log: %s\n", kLogPrefix.UTF8String, name.UTF8String);
            }
        }
    });
}

@end

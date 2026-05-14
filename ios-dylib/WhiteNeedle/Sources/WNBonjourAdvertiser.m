#import "WNBonjourAdvertiser.h"
#import <UIKit/UIKit.h>

NSString *const kWNServiceType = @"_whiteneedle._tcp.";

@interface WNBonjourAdvertiser () <NSNetServiceDelegate>
@property (nonatomic, strong) NSNetService *netService;
@property (nonatomic, assign) NSInteger lastPort;
@property (nonatomic, assign) NSInteger lastInspectorPort;
@end

@implementation WNBonjourAdvertiser

- (instancetype)init {
    self = [super init];
    if (self) {
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(appWillEnterForeground)
                                                     name:UIApplicationWillEnterForegroundNotification
                                                   object:nil];
    }
    return self;
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)appWillEnterForeground {
    if (self.lastPort > 0) {
        NSLog(@"[WhiteNeedle] Bonjour: App entering foreground, restarting advertisement...");
        [self startWithPort:self.lastPort inspectorPort:self.lastInspectorPort];
    }
}

- (void)startWithPort:(NSInteger)port {
    [self startWithPort:port inspectorPort:0];
}

- (void)startWithPort:(NSInteger)port inspectorPort:(NSInteger)inspectorPort {
    self.lastPort = port;
    self.lastInspectorPort = inspectorPort;

    if (self.netService) {
        [self stop];
    }

    NSString *bundleId = [[NSBundle mainBundle] bundleIdentifier] ?: @"unknown";
    NSString *deviceName = [[UIDevice currentDevice] name];
    NSString *vendorId = [[[UIDevice currentDevice] identifierForVendor] UUIDString] ?: @"unknown";
    NSString *deviceId = [NSString stringWithFormat:@"%@|%@", bundleId, vendorId];
    NSString *serviceName = [NSString stringWithFormat:@"%@|%@", deviceName, bundleId];

    self.netService = [[NSNetService alloc] initWithDomain:@""
                                                      type:kWNServiceType
                                                      name:serviceName
                                                      port:(int)port];
    self.netService.delegate = self;

    NSMutableDictionary *txtDict = [@{
        @"deviceId": deviceId,
        @"bundleId": bundleId,
        @"device": deviceName,
        @"systemVersion": [[UIDevice currentDevice] systemVersion],
        @"model": [[UIDevice currentDevice] model],
        @"wnVersion": @"2.0.0",
        @"enginePort": [@(port) stringValue],
        @"engineType": @"jscore",
    } mutableCopy];

    if (inspectorPort > 0) {
        txtDict[@"inspectorPort"] = [@(inspectorPort) stringValue];
    }

    NSData *txtData = [NSNetService dataFromTXTRecordDictionary:
                       [self encodeTXTDictionary:txtDict]];
    [self.netService setTXTRecordData:txtData];
    [self.netService publish];

    _isPublishing = YES;
    NSLog(@"[WhiteNeedle] Bonjour: Publishing '%@' on port %ld (inspector: %ld, deviceId: %@)", serviceName, (long)port, (long)inspectorPort, deviceId);
}

- (void)stop {
    [self.netService stop];
    self.netService = nil;
    _isPublishing = NO;
    NSLog(@"[WhiteNeedle] Bonjour: Service stopped");
}

- (NSDictionary<NSString *, NSData *> *)encodeTXTDictionary:(NSDictionary<NSString *, NSString *> *)dict {
    NSMutableDictionary *encoded = [NSMutableDictionary dictionary];
    for (NSString *key in dict) {
        encoded[key] = [dict[key] dataUsingEncoding:NSUTF8StringEncoding];
    }
    return encoded;
}

#pragma mark - NSNetServiceDelegate

- (void)netServiceDidPublish:(NSNetService *)sender {
    NSLog(@"[WhiteNeedle] Bonjour: Service published successfully - %@:%ld",
          sender.name, (long)sender.port);
}

- (void)netService:(NSNetService *)sender didNotPublish:(NSDictionary<NSString *, NSNumber *> *)errorDict {
    NSLog(@"[WhiteNeedle] Bonjour: Failed to publish - %@", errorDict);
    _isPublishing = NO;
}

- (void)netServiceDidStop:(NSNetService *)sender {
    NSLog(@"[WhiteNeedle] Bonjour: Service did stop");
    _isPublishing = NO;
}

@end

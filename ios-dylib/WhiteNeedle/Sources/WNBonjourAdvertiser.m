#import "WNBonjourAdvertiser.h"
#import <UIKit/UIKit.h>

NSString *const kWNServiceType = @"_whiteneedle._tcp.";

@interface WNBonjourAdvertiser () <NSNetServiceDelegate>
@property (nonatomic, strong) NSNetService *netService;
@end

@implementation WNBonjourAdvertiser

- (void)startWithPort:(NSInteger)port {
    if (self.netService) {
        [self stop];
    }

    NSString *bundleId = [[NSBundle mainBundle] bundleIdentifier] ?: @"unknown";
    NSString *deviceName = [[UIDevice currentDevice] name];
    NSString *serviceName = [NSString stringWithFormat:@"%@|%@", deviceName, bundleId];

    self.netService = [[NSNetService alloc] initWithDomain:@""
                                                      type:kWNServiceType
                                                      name:serviceName
                                                      port:(int)port];
    self.netService.delegate = self;

    NSDictionary *txtDict = @{
        @"bundleId": bundleId,
        @"device": deviceName,
        @"systemVersion": [[UIDevice currentDevice] systemVersion],
        @"model": [[UIDevice currentDevice] model],
        @"wnVersion": @"2.0.0",
        @"enginePort": [@(port) stringValue],
        @"engineType": @"jscore",
    };
    NSData *txtData = [NSNetService dataFromTXTRecordDictionary:
                       [self encodeTXTDictionary:txtDict]];
    [self.netService setTXTRecordData:txtData];
    [self.netService publish];

    _isPublishing = YES;
    NSLog(@"[WhiteNeedle] Bonjour: Publishing '%@' on port %ld", serviceName, (long)port);
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

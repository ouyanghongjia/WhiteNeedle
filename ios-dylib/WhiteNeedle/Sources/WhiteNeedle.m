#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <ifaddrs.h>
#import <net/if.h>
#import <arpa/inet.h>
#import <netinet/in.h>
#import "WNJSEngine.h"
#import "WNRemoteServer.h"
#import "WNBonjourAdvertiser.h"
#import "WNNetworkMonitor.h"
#import "WNCurlMonitor.h"
#import "WNWebViewProbe.h"
#import "WNNativeLogCapture.h"

/*
 * Static linker + CocoaPods: `-ObjC` only pulls .o files from libWhiteNeedle.a that define an
 * Objective-C class or category. This file had only a `static` constructor → the whole
 * WhiteNeedle.o could be omitted, so `WhiteNeedleInit` never ran. A tiny @implementation
 * forces the unit to link. (Injected framework loads the whole image; constructor still runs.)
 */
@interface WNWhiteNeedleEntry : NSObject
@end
@implementation WNWhiteNeedleEntry
@end

static WNBonjourAdvertiser *g_advertiser = nil;
static WNRemoteServer *g_remoteServer = nil;
static const NSInteger kDefaultEnginePort = 27042;

static NSArray<NSString *> *WNEnumerateInterfaceIPs(void) {
    NSMutableArray<NSString *> *out = [NSMutableArray array];
    struct ifaddrs *ifaddr = NULL;
    if (getifaddrs(&ifaddr) != 0 || ifaddr == NULL) {
        return out;
    }

    for (struct ifaddrs *ifa = ifaddr; ifa != NULL; ifa = ifa->ifa_next) {
        if (ifa->ifa_addr == NULL) continue;
        sa_family_t family = ifa->ifa_addr->sa_family;
        if (!(ifa->ifa_flags & IFF_UP) || (ifa->ifa_flags & IFF_LOOPBACK)) continue;
        if (family != AF_INET && family != AF_INET6) continue;

        char addrBuf[INET6_ADDRSTRLEN] = {0};
        const void *addrPtr = NULL;
        if (family == AF_INET) {
            addrPtr = &((struct sockaddr_in *)ifa->ifa_addr)->sin_addr;
        } else {
            addrPtr = &((struct sockaddr_in6 *)ifa->ifa_addr)->sin6_addr;
        }
        if (!inet_ntop(family, addrPtr, addrBuf, sizeof(addrBuf))) continue;
        [out addObject:[NSString stringWithFormat:@"%s=%s", ifa->ifa_name, addrBuf]];
    }

    freeifaddrs(ifaddr);
    return out;
}

static NSString *WNPreferredIPv4Address(void) {
    NSArray<NSString *> *all = WNEnumerateInterfaceIPs();
    for (NSString *line in all) {
        NSRange sep = [line rangeOfString:@"="];
        if (sep.location == NSNotFound) continue;
        NSString *ip = [line substringFromIndex:sep.location + 1];
        if ([ip hasPrefix:@"169.254."] || [ip hasPrefix:@"127."]) continue;
        if ([ip containsString:@"."]) return ip;
    }
    for (NSString *line in all) {
        NSRange sep = [line rangeOfString:@"="];
        if (sep.location == NSNotFound) continue;
        NSString *ip = [line substringFromIndex:sep.location + 1];
        if ([ip containsString:@"."]) return ip;
    }
    return @"unknown";
}

__attribute__((constructor))
static void WhiteNeedleInit(void) {
    @autoreleasepool {
        // Phase 1: redirect stderr as early as possible so startup logs are captured to JSONL.
        [[WNNativeLogCapture shared] beginCapture];

        NSLog(@"[WhiteNeedle] ====================================");
        NSLog(@"[WhiteNeedle] WhiteNeedle v2.0.0 Initializing...");
        NSLog(@"[WhiteNeedle] Engine: JavaScriptCore (no JIT required)");
        NSLog(@"[WhiteNeedle] Bundle: %@", [[NSBundle mainBundle] bundleIdentifier]);
        NSLog(@"[WhiteNeedle] ====================================");

        [[WNJSEngine sharedEngine] setup];

        [WNWebViewProbe install];

        NSString *frameworksPath = [[NSBundle mainBundle] privateFrameworksPath];
        NSString *bootstrapPath = [frameworksPath stringByAppendingPathComponent:@"whiteneedle_bootstrap.js"];
        if ([[NSFileManager defaultManager] fileExistsAtPath:bootstrapPath]) {
            NSString *code = [NSString stringWithContentsOfFile:bootstrapPath encoding:NSUTF8StringEncoding error:nil];
            if (code) {
                [[WNJSEngine sharedEngine] loadScript:code name:@"bootstrap.js"];
                NSLog(@"[WhiteNeedle] Bootstrap script loaded");
            }
        }

        dispatch_async(dispatch_get_main_queue(), ^{
            g_remoteServer = [[WNRemoteServer alloc] initWithEngine:[WNJSEngine sharedEngine]
                                                               port:(uint16_t)kDefaultEnginePort];
            [g_remoteServer start];

            [[WNNetworkMonitor shared] startWithServer:g_remoteServer];
            [[WNCurlMonitor shared] startWithServer:g_remoteServer];
            // Phase 2: attach server for live push; triggers flush of any startup-buffered logs.
            [[WNNativeLogCapture shared] attachServer:g_remoteServer];

            uint16_t actualPort = g_remoteServer.port;

            g_advertiser = [[WNBonjourAdvertiser alloc] init];
            [g_advertiser startWithPort:actualPort];
            NSArray<NSString *> *ips = WNEnumerateInterfaceIPs();
            NSLog(@"[WhiteNeedle] Network interfaces: %@", ips.count ? [ips componentsJoinedByString:@", "] : @"(none)");
            NSLog(@"[WhiteNeedle] Preferred IPv4: %@", WNPreferredIPv4Address());
            NSLog(@"[WhiteNeedle] Ready for remote debugging on port %d", actualPort);
            NSLog(@"[WhiteNeedle] Inspector: JSContext registered with system RemoteInspector as 'WhiteNeedle'");
            NSLog(@"[WhiteNeedle] Inspector: Use Safari or ios_webkit_debug_proxy to debug");
        });
    }
}

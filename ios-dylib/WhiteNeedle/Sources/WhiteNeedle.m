#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import "WNJSEngine.h"
#import "WNRemoteServer.h"
#import "WNBonjourAdvertiser.h"
#import "WNNetworkMonitor.h"
#import "WNCurlMonitor.h"
#import "WNWebViewProbe.h"

/*
 * Static linker + CocoaPods: `-ObjC` only pulls .o files from libWhiteNeedle.a that define an
 * Objective-C class or category. This file had only a `static` constructor → the whole
 * WhiteNeedle.o could be omitted, so `WhiteNeedleInit` never ran. A tiny @implementation
 * forces the unit to link. (Injected .dylib loads the whole image; constructor still runs.)
 */
@interface WNWhiteNeedleEntry : NSObject
@end
@implementation WNWhiteNeedleEntry
@end

static WNBonjourAdvertiser *g_advertiser = nil;
static WNRemoteServer *g_remoteServer = nil;
static const NSInteger kDefaultEnginePort = 27042;

__attribute__((constructor))
static void WhiteNeedleInit(void) {
    @autoreleasepool {
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

            g_advertiser = [[WNBonjourAdvertiser alloc] init];
            [g_advertiser startWithPort:kDefaultEnginePort];
            NSLog(@"[WhiteNeedle] Ready for remote debugging on port %ld", (long)kDefaultEnginePort);
            NSLog(@"[WhiteNeedle] Inspector: JSContext registered with system RemoteInspector as 'WhiteNeedle'");
            NSLog(@"[WhiteNeedle] Inspector: Use Safari or ios_webkit_debug_proxy to debug");
        });
    }
}

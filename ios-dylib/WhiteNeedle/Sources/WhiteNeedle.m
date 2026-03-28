#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import "WNJSEngine.h"
#import "WNRemoteServer.h"
#import "WNBonjourAdvertiser.h"

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

            g_advertiser = [[WNBonjourAdvertiser alloc] init];
            [g_advertiser startWithPort:kDefaultEnginePort];
            NSLog(@"[WhiteNeedle] Ready for remote debugging on port %ld", (long)kDefaultEnginePort);
        });
    }
}

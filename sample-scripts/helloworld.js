var a = 10;
console.log("a:" + a)
var b = a + 20;
console.log("b:" + b)

dispatch.mainAsync(function() {
    var app = ObjC.use('UIApplication').invoke('sharedApplication');
    var windows = app.invoke('windows');
    var count = windows.invoke('count');

    var rootView = null;
    for (var i = 0; i < count; i++) {
        var win = windows.invoke('objectAtIndex:', [i]);
        var rootVC = win.invoke('rootViewController');
        if (rootVC && rootVC.invoke) {
            var v = rootVC.invoke('view');
            if (v && v.invoke) {
                rootView = v;
                break;
            }
        }
    }

    // if (!rootView) {
    //     console.log('[Test7] No rootView found in any window');
    //     return;
    // }

    var layer = rootView.invoke('layer');
    // var gold = ObjC.use('UIColor').invoke('colorWithRed:green:blue:alpha:', [1.0, 0.84, 0.0, 1.0]);
    var redColor = ObjC.use('UIColor').invoke('greenColor');
    layer.invoke('setBorderColor:', [redColor.invoke('CGColor')]);
    layer.invoke('setBorderWidth:', [16.0]);
    layer.invoke('setCornerRadius:', [16.0]);
    layer.invoke('setMasksToBounds:', [true]);
    layer.invoke('setNeedsDisplay');

});


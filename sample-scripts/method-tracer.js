// WhiteNeedle: Trace method calls on a specific ObjC class

var CLASS_NAME = 'NSURLSession';
var METHOD_FILTER = null;  // e.g., 'dataTask' to only trace matching methods

var cls = ObjC.use(CLASS_NAME);
if (!cls) {
    console.error('[Tracer] Class not found: ' + CLASS_NAME);
} else {
    var methods = ObjC.classes[CLASS_NAME].invoke('_methodList');
    console.log('[Tracer] Hooking methods on ' + CLASS_NAME);

    // Hook a specific well-known method
    Interceptor.attach('-[' + CLASS_NAME + ' dataTaskWithRequest:completionHandler:]', {
        onEnter: function(self) {
            console.log('[Tracer] ' + CLASS_NAME + ' dataTaskWithRequest:completionHandler: called');
        },
        onLeave: function() {
            console.log('[Tracer] returned');
        }
    });

    console.log('[Tracer] Ready — monitoring ' + CLASS_NAME);
}

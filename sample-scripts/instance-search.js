// WhiteNeedle: Instance search helper
// Provides RPC methods to find live instances of ObjC classes

rpc.exports = {
    findInstances: function(className) {
        // On non-jailbroken devices, heap scanning is limited.
        // Use known singletons and class hierarchy traversal instead.
        var cls = ObjC.use(className);
        if (!cls) return { error: 'Class not found: ' + className };

        var result = {
            className: className,
            description: cls.invoke('description').toString(),
        };

        // Try common singleton patterns
        var singletonSelectors = [
            'sharedInstance', 'shared', 'defaultManager',
            'sharedManager', 'currentDevice', 'sharedApplication'
        ];

        for (var i = 0; i < singletonSelectors.length; i++) {
            var sel = singletonSelectors[i];
            try {
                var instance = cls.invoke(sel);
                if (instance) {
                    result.singleton = {
                        selector: sel,
                        description: instance.invoke('description').toString()
                    };
                    break;
                }
            } catch(e) {
                // selector not found, skip
            }
        }

        return result;
    }
};

console.log('[Search] Instance search loaded. Call rpcCall("findInstances", ["UIDevice"]).');

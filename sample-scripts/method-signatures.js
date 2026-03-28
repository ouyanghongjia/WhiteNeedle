// WhiteNeedle: Method signature inspector
// Provides RPC to query detailed method signatures of ObjC classes

rpc.exports = {
    getSignatures: function(className, filter) {
        var cls = ObjC.use(className);
        if (!cls) return { error: 'Class not found: ' + className };

        // Use the bridge to enumerate methods
        // This is handled natively by WNObjCBridge
        return {
            className: className,
            hint: 'Use getMethods RPC on the device manager for full method lists'
        };
    },

    describeClass: function(className) {
        var cls = ObjC.use(className);
        if (!cls) return { error: 'Class not found' };

        var superCls = cls.invoke('superclass');
        var superName = superCls ? superCls.invoke('description').toString() : 'none';

        return {
            name: className,
            superclass: superName,
            description: cls.invoke('description').toString()
        };
    }
};

console.log('[Signatures] Method signature inspector loaded.');
console.log('  rpcCall("describeClass", ["NSObject"])');

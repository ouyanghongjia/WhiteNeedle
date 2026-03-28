// WhiteNeedle: Dump ObjC class information
// Lists classes matching a filter and their methods

var FILTER = 'UIView';

var classNames = ObjC.classes;
var count = 0;

// Use the direct API to enumerate
var allClasses = ObjC.classes;
console.log('[ClassDump] Enumerating classes matching: ' + FILTER);

// The ObjC.classes proxy provides class access
var target = ObjC.use(FILTER);
if (target) {
    console.log('[ClassDump] Found: ' + FILTER);
    console.log('[ClassDump] Use getMethods RPC to list methods');
} else {
    console.log('[ClassDump] Class not found: ' + FILTER);
}

// Export as RPC for remote querying
rpc.exports = {
    getClassInfo: function(className) {
        var cls = ObjC.use(className);
        if (!cls) return { error: 'Class not found' };
        return {
            name: className,
            description: cls.invoke('description').toString()
        };
    }
};

console.log('[ClassDump] Script loaded. Use rpcCall("getClassInfo", ["UIView"]) to query.');

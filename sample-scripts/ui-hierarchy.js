// WhiteNeedle: UI hierarchy inspector
// Dumps the current view hierarchy from the key window

rpc.exports = {
    dumpUI: function(maxDepth) {
        maxDepth = maxDepth || 10;
        var app = ObjC.use('UIApplication').invoke('sharedApplication');
        var windows = app.invoke('windows');
        var count = windows.invoke('count');

        var result = [];
        for (var i = 0; i < count; i++) {
            var win = windows.invoke('objectAtIndex:', i);
            result.push(describeView(win, 0, maxDepth));
        }
        return result;
    },

    keyWindowInfo: function() {
        var app = ObjC.use('UIApplication').invoke('sharedApplication');
        var scenes = app.invoke('connectedScenes');
        var desc = scenes.invoke('description');
        return desc ? desc.toString() : 'no scenes';
    }
};

function describeView(view, depth, maxDepth) {
    if (depth >= maxDepth) return '...';

    var cls = view.invoke('class').invoke('description').toString();
    var frame = view.invoke('frame');
    var hidden = view.invoke('isHidden');

    var info = {
        class: cls,
        hidden: hidden ? true : false,
        depth: depth
    };

    var subviews = view.invoke('subviews');
    var subCount = subviews.invoke('count');
    if (subCount > 0) {
        info.children = [];
        for (var i = 0; i < subCount && i < 50; i++) {
            var child = subviews.invoke('objectAtIndex:', i);
            info.children.push(describeView(child, depth + 1, maxDepth));
        }
    }

    return info;
}

console.log('[UI] UI hierarchy inspector loaded. Call rpcCall("dumpUI") to dump.');

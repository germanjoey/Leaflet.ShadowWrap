/* globals L:true */

// *************************************************************************************
// *************************************************************************************

// a very hackish setup designed to help plugins that muck with the internals of shapes
// the idea is that you can block shadow dispatching in very specific cases
// for example:
//     L.ShadowWrap.addShadowException('Path', 'setStyle', L.Edit.SimpleShape.prototype.removeHooks);
//     L.ShadowWrap.addShadowException('Path', 'setStyle', L.Edit.PolyVerticesEdit.prototype.removeHooks);
//
// blocks shadow dispatching of 'setStyle' by LeafletDraw when called from L.Edit.SimpleShape.prototype.removeHooks
// or L.Edit.PolyVerticesEdit.prototype.removeHooks so that the shadow shape doesn't get its style reverted
// when entering or leaving edit mode when those functions loop over all shapes in drawnItems.

L.ShadowWrap.shadowExceptions = {};
L.ShadowWrap.addShadowException = function (className, methodName, exception) {
    className = className.replace('L.', '');
    
    if (! L.ShadowWrap.shadowExceptions[className].hasOwnProperty(methodName)) {
        L.ShadowWrap.shadowExceptions[className][methodName] = [];
    }
    
    L.ShadowWrap.shadowExceptions[className][methodName].push(exception);
};

L.ShadowWrap.removeShadowException = function (className, methodName, exceptionToRemove) {
    className = className.replace('L.', '');
    
    if (! L.ShadowWrap.shadowExceptions[className].hasOwnProperty(methodName)) {
        return;
    }
    
    var cleaned = [];
    for (var i=0; i<L.ShadowWrap.shadowExceptions[className][methodName].length; i++) {
        var m = L.ShadowWrap.shadowExceptions[className][methodName];
        if (m != exceptionToRemove) {
            cleaned.push(m);
        }
    }
    
    L.ShadowWrap.shadowExceptions[className][methodName] = cleaned;
};

L.ShadowWrap.checkExceptions = function (className, methodName, obj) {
    if (L.ShadowWrap.shadowExceptions[className].hasOwnProperty(methodName)) {
        var exs = L.ShadowWrap.shadowExceptions[className][methodName];
        for (var i=0; i<exs.length; i++) {
            if (obj[methodName].caller === exs[i]) {
                return true;
            }
        }
    }
    
    return false;
};
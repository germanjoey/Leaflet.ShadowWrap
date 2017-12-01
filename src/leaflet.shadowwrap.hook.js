/* globals L:true */
// jshint laxbreak:true

L.ShadowWrap = {};

L.ShadowWrap.minimumWrapDistance = 0;
L.ShadowWrap.EventsToShadow = ['contextmenu', 'click', 'dblclick', 'mousedown', 'mouseover', 'mouseout'];

// a brief overview of what's going on here.
//
// the problem this plugin is trying to solve is that if a shape crosses over a wrap line on a
// leaflet map (e.g. the international dateline on a map of earth), then the shape will mysteriously disappear
// when a user pans over the wrap line. on one side it is there, and seems to cross the wrap line just fine,
// and then poof, its gone.
//
// this strange situation is because leaflet clips shapes that are outside of its display zone. say you
// have a shape that spans from -88lat to 88lat (antarctic to artic) and 170 lng to 190lng. longitude wraps
// from -180 to 180, so 190lng is translated into -170lng. (170lng = eastern russia, -170lng = alaska) now
// imagine you're looking at it zoomed all the way out, so you can see pretty much a whole hemisphere
// of the earth. if you look at russia, you see this shape just fines, but as you pan east to california,
// it'll disappear because it is displayed on a pane tied to coordinates 360 degrees away. 
//
// so, what this plugin does is create a "shadow" copy of a shape whenever it happens to cross a wrap line.
// the shadow(s) will be added to whatever the main shape is added to, and events on the shadow are forwarded
// to the corresponding one on the main shape. (e.g. clicks, etc). furthermore, updates on the main shape
// (coordinate changes, style changes, etc) will be reflected in the shadow.
//
// this is all set up transparently by wrapping various shape methods with some extra code that checks for,
// and creates, these shadows. what methods are wrapped, and how, is specified in the table below.
//
// you can also change the table, if you so desire. a rundown of the different shadow method types:
//
// (unmentioned) - these will execute like normal, without involving the shadow in anyways. e.g., getLatLng
//                 on a circle will return the latlng of the center of the main circle
//
//  simple - if the shape has a shadow, then when a call to this method is reached then execution will split
//           to any shadows it has. note that further encountered shadow methods will not cause another split
//           all arguments are passed through to the original method unchanged
//
//  translated - like simple, but the second argument of these methods, a latlng, will be translated according
//               to its shadow type (normalizeLL for the main shape)
//
//  translateRechecked - like translate, but then the shape's latlngs are checked afterwards to see if any
//                       new shadows need to be created or removed
//
//  multiLatlngs - like translateRechecked, but special-purposed for arrays of latlngs. also note this has to
//                 deal with a bit of extra wackiness because L.Polygon._setLatLngs and L.Polygon._convertLatLngs
//                 both dispatch to its prototype in L.Polyline
//
//  special - only one method, L.Rectangle._boundsToLatLngs, is in this category. it adds a wrapper whose
//            purpose is to allow an array of coordinate tuples to be passed to the rect's initialize method,
//            as with polygon and polyine's init method. this category also exists if there's any custom methods
//            that one needs to implement that are defined on the various shapes. 

L.ShadowWrap.ShadowDefinitions = {
    'L.Layer': {
        'translated': [['openTooltip', 1], ['openPopup', 1]],
        'simple': [
            'bindTooltip', 'unbindTooltip', 'closeTooltip', 'toggleTooltip',
            'bindPopup', 'unbindPopup', 'closePopup', 'togglePopup'
        ],
    },
    
    'L.Path': {
        'simple': ['bringToBack', 'bringToFront', 'setStyle', 'redraw', '_reset'],
    },
    
    'L.Polyline': {
        'addInitHook': true,
        'simple': ['_update'],
        'multiLatlngs': ['_setLatLngs', '_convertLatLngs'],
        'translateRechecked': [['addLatLng', 0]],
    },
    
    'L.Polygon': {
        'multiLatlngs': ['_setLatLngs', '_convertLatLngs'],
    },
    
    'L.Rectangle': {
        'special': ['_boundsToLatLngs'],
    },
    
    'L.Marker': {
        'addInitHook': true,
        'simple': ['setZIndexOffset', 'setIcon', '_setPos', 'update', 'setOpacity'],
        'translateRechecked': [['setLatLng', 0]],
    },
    
    'L.CircleMarker': {
        'addInitHook': true,
        'simple': ['setStyle', '_updateBounds', '_update'],
        'rechecked': ['setRadius'],
        'translateRechecked': [['setLatLng', 0]],
    },
    
    'L.Circle': {
        'simple': [''],
        'rechecked': ['setRadius'],
        'translateRechecked': [['setLatLng', 0]],
    }
};


// see the huge table and corresponding comment at the top of this file to understand what this is doing
L.ShadowWrap.installShadowHooks = function (className, classSettings) {
    className = className.replace('L.', '');
    
    var i;
    var methodName;
    var translationIndex;
    var cls = L[className];
    
    L.ShadowWrap.shadowExceptions[className] = {};
    if (classSettings.hasOwnProperty('addInitHook') && (classSettings.addInitHook === true)) {
        cls.addInitHook(L.ShadowWrap.initializeShadowHooks);
    }
    
    if (classSettings.hasOwnProperty('simple')) {
        for (i=0; i<classSettings.simple.length; i++) {
            methodName = classSettings.simple[i];
            L.ShadowWrap.installShadowMethod(cls, className, methodName, null, false);
        }
    }
        
    if (classSettings.hasOwnProperty('rechecked')) {
        for (i=0; i<classSettings.rechecked.length; i++) {
            methodName = classSettings.rechecked[i];
            L.ShadowWrap.installShadowMethod(cls, className, methodName, null, true);
        }
    }
        
    if (classSettings.hasOwnProperty('translated')) {
        for (i=0; i<classSettings.translated.length; i++) {
            methodName = classSettings.translated[i][0];
            translationIndex = classSettings.translated[i][1];
            L.ShadowWrap.installShadowMethod(cls, className, methodName, translationIndex, false);
        }
    }
        
    if (classSettings.hasOwnProperty('translateRechecked')) {
        for (i=0; i<classSettings.translateRechecked.length; i++) {
            methodName = classSettings.translateRechecked[i][0];
            translationIndex = classSettings.translateRechecked[i][1];
            L.ShadowWrap.installShadowMethod(cls, className, methodName, translationIndex, true);
        }
    }
        
    if (classSettings.hasOwnProperty('multiLatlngs')) {
        for (i=0; i<classSettings.multiLatlngs.length; i++) {  
            methodName = classSettings.multiLatlngs[i];
            L.ShadowWrap.installInheritedShadowMethod(cls, className, methodName);
        }
    }
        
    if (classSettings.hasOwnProperty('special')) {
        for (i=0; i<classSettings.special.length; i++) {
            methodName = classSettings.special[i];
            cls.prototype[methodName + '__original'] = cls.prototype[methodName];
            cls.prototype[methodName] = L.ShadowWrap.SpecialMethods[methodName];
        }
    }
};

// *************************************************************************************
// *************************************************************************************

// L.ShadowWrap.addExtension is used for integrating ShadowWrap into other plugins, if they
// happen to modify one of the shapes' prototypes. basically, it allows you to add your stuff
// to the ShadowDefinitions table before the table gets stuffed into the leaflet geometry prototype(s)
L.ShadowWrap.initRun = false;
L.ShadowWrap.extensions = {};
L.ShadowWrap.addExtension = function (extensionName, initializerCallback) {
    if (L.ShadowWrap.initRun === false) {
        L.ShadowWrap.extensions[extensionName] = initializerCallback;
    }
    else {
        initializerCallback();
    }
};

// the main installation method, to be manually called in your main.js or whatever
// (the manual call is so that you can add stuff to L.ShadowWrap.EventsToShadow and
// L.ShadowWrap.ShadowDefinitions if you have some sort of other plugin, or whatever)
L.ShadowWrap.initialize = function () {
    if (L.ShadowWrap.initRun === true) {
        return;
    }

    // for leaflet.textpath.js
    if (L.Polyline.prototype.hasOwnProperty('setText')) {
        L.ShadowWrap.ShadowDefinitions['L.Polyline'].simple.push('setText');
    }

    for (var className in L.ShadowWrap.ShadowDefinitions) {
        if (L.ShadowWrap.ShadowDefinitions.hasOwnProperty(className)) {
            L.ShadowWrap.installShadowHooks(className, L.ShadowWrap.ShadowDefinitions[className]);
        }
    }
        
    for (var extensionName in L.ShadowWrap.extensions) {
        if (L.ShadowWrap.extensions.hasOwnProperty(extensionName)) {
            L.ShadowWrap.extensions[extensionName]();
        }
    }
    
    L.ShadowWrap.initRun = true;
};
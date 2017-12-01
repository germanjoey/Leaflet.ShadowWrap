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
/* globals L:true */

// *************************************************************************************
// *************************************************************************************

// the shadow constructor, which sounds like the name of one hell of a chinese webnovel
L.ShadowWrap.initializeShadowHooks = function () {
    if (this.options.hasOwnProperty('noShadow')) {
        return;
    }

    if (this.hasOwnProperty('shadowOptions')) {
        return;
    }
    
    this.shadowOptions = {
        'isShape': true,
        'shadowShapes': {},
        'shadowSplit': false,
        'secondaryExecutor': false,
        'blockChanges': false
    };
    
    if (this.options.hasOwnProperty('isShadow') && (this.options.isShadow === true)) {
        return;
    }

    this.shadowOptions.shadowType = 'normalizeLL';
    this.shadowOptions.isShadow = false;
    
    this.on('add', this.addShadows, this);
    this.on('remove', this.removeAllShadows, this);
};


L.ShadowWrap.installShadowMethod = function (cls, className, methodName, translate, recheck) {
    var dispatchedMethodName = methodName + '__original' + className;
    var isSingle = !((cls.prototype instanceof L.Polyline) || (cls === L.Polyline));
    
    // set the original method name to methodName__original and e.g.
    // methodName__originalRectangle, or whatever the className is
    // the first one is so that we can still manually call a few things later on, like __update,
    // without needing to figure out what class we want
    cls.prototype[methodName + '__original'] = cls.prototype[methodName];
    cls.prototype[dispatchedMethodName] = cls.prototype[methodName];
    
    // now install the wrapper
    cls.prototype[methodName] = function () {
        var args = Array.prototype.slice.call(arguments);
        
        // first, check if this call isn't need or if this is a subordinate call
        var sd = this.shadowDispatchChecks(className, methodName, className, args);
        if (sd.dispatched) {
            return sd.dispatchResult;
        }

        // if we know it's a main call, we flag it so that we don't split again further down the call chain
        this.shadowOptions.shadowSplit = true;
        
        // now do the main call
        var ret = this[dispatchedMethodName].apply(this, L.ShadowWrap.translateArgs(this, translate, args));
            
        // now dispatch the same call out to any shadow shapes that the main shape has
        // recheck means that some methods (e.g. addLatLng) need to recheck their shadows after the main call
        if (recheck) {
            var latlngs = (isSingle) ? [this._latlng] : this._latlngs;
            this.updatingShadowDispatch(dispatchedMethodName, true, translate, args, latlngs);
        }
        else {
            this.shadowDispatch(dispatchedMethodName, translate, args);
        }
        
        // now clean up and return
        this.shadowOptions.shadowSplit = false;
        
        if (translate !== null) {
            this._fixShape();
        }
        
        return ret;
    };
};

// this is for Polyline/Polygon ._setLatLngs and _convertLatLngs
// very similar to the above, but note that we are forced to always use the className in the method
// dispatch because those four methods are linked to each other via prototype calls. so, we basically
// need to manually orchestrate that.
L.ShadowWrap.installInheritedShadowMethod = function (cls, className, methodName) {
    var dispatchedMethodName = methodName + '__original' + className;
    
    cls.prototype[dispatchedMethodName] = cls.prototype[methodName];
    cls.prototype[methodName] = function (latlngs) {
        var sd = this.shadowDispatchChecks(className, methodName, className, [latlngs]);
        if (sd.dispatched) {
            return sd.dispatchResult;
        }
        
        this.shadowOptions.shadowSplit = true;
        var llo = this.updatingShadowDispatch(dispatchedMethodName, false, null, [], latlngs);
        
        var ret = this[dispatchedMethodName](llo.latlngs[this.shadowOptions.shadowType]);
        this.shadowOptions.shadowSplit = false;
        
        return ret;
    }; 
};

// for openTooltip/openPopup/addLatLng; we only translate the second arg, the latlng
L.ShadowWrap.translateArgs = function (shape, translationIndex, arglist) {
    if (translationIndex === null) {
        return arglist;
    }

    var translated = [];
    for (var i=0; i<arglist.length; i++) {
        if (i === translationIndex) {
            var t = shape.guideLL(arglist[i]);
            translated.push(t);
        }
        else {
            translated.push(arglist[i]);
        }
    }
    
    return translated;
};

// *************************************************************************************
// *************************************************************************************

L.ShadowWrap.SpecialMethods = {};

// allow L.Rectangle to be created from an array of coordinate tuples, as with L.Polyline
// and L.Polygon, to simplify some logic elsewhere
L.ShadowWrap.SpecialMethods._boundsToLatLngs = function (latLngBounds) {
    if (Array.isArray(latLngBounds) && (latLngBounds.length > 0)) {
        var conv = latLngBounds;
        if (Array.isArray(latLngBounds[0]) && (latLngBounds[0][0] instanceof L.LatLng)) {
            conv = latLngBounds[0];
        }
        
        var ll_latLngBounds = [];
        for (var i=0; i<conv.length; i++) {
            ll_latLngBounds.push(L.latLng(conv[i]));
        }
        latLngBounds = ll_latLngBounds;
    }
    
    return this._boundsToLatLngs__original(latLngBounds);
};
/* globals L:true */

L.Layer.include({
    
    addShadows: function (restoreFromCache) {
        if (this.shadowOptions.isShadow) {
            return;
        }
        
        if (this.options.noShadow) {
            delete this.options.noShadow;
        }
    
        var isSingle = !(this instanceof L.Polyline);
        var llo = this.calcShadow((isSingle) ? [this._latlng] : this._latlngs);
        
        // if we've just been added to the map, then our main shape's coordinates
        // haven't been normalized yet. so we should set them now, using the 
        // coordinates we've just so conveniently calculated
        
        var shadowType = this.shadowOptions.shadowType;
        
        if (isSingle) {
            this._latlng = llo.latlngs[shadowType][0];
        }
        else {
            if (this instanceof L.Polyline) {
                this._setLatLngs__originalPolyline(llo.latlngs[shadowType]);
            }
            else {
                this._setLatLngs__originalPolygon(llo.latlngs[shadowType]);
            }
        }
        
        this.changeShadows(llo, restoreFromCache);
        this._fixShape();
    },
    
    removeAllShadows: function () {
        if (this.shadowOptions.isShadow) {
            return;
        }
        
        for (var shadowType in this.shadowOptions.shadowShapes) {
            if (this.shadowOptions.shadowShapes.hasOwnProperty(shadowType)) {
                this._removeShadowShape(shadowType);
            }
        }
    },
    
    // add or remove any shadows based on calculations done by calcShadow
    changeShadows: function (llo, restoreFromCache) {
        var changed = {};
        if (this.shadowOptions.isShadow) {
            return changed;
        }
        
        if (this.shadowOptions.blockChanges) {
            return changed;
        }
    
        for (var shadowType in llo.needsShadow) {
            if (llo.needsShadow.hasOwnProperty(shadowType)) {
                if (shadowType == this.shadowOptions.shadowType) {
                    continue;
                }
            
                var n = llo.needsShadow[shadowType];
                var o = this.shadowOptions.shadowShapes.hasOwnProperty(shadowType);
                
                if (n && !o) {
                    changed[shadowType] = true;
                    this._addShadow(shadowType, llo.latlngs[shadowType], restoreFromCache);
                }
                else if (!n && o) {
                    changed[shadowType] = true;
                    this._removeShadowShape(shadowType);
                }
            }
        }
        
        return changed;
    },
    
    // *************************************************************************************
    // *************************************************************************************

    // dispatch our method call to whatever shadow shapes our main shape has
    shadowDispatch: function (dispatchedMethodName, translate, args) {
        for (var shadowType in this.shadowOptions.shadowShapes) {
            if (this.shadowOptions.shadowShapes.hasOwnProperty(shadowType)) {
                var shadowShape = this.shadowOptions.shadowShapes[shadowType];
                shadowShape.shadowOptions.secondaryExecutor = true;
                
                var passedArgs = L.ShadowWrap.translateArgs(shadowShape, translate, args);
                shadowShape[dispatchedMethodName].apply(shadowShape, passedArgs);
                shadowShape.shadowOptions.secondaryExecutor = false;
                    
                if (translate !== null) {
                    shadowShape._fixShape();
                }
            }
        }
    },
    
    // first, update our latlngs, create/remove any shadows that need be, and then dispatch
    // our method call to whatever shadow shapes our main shape has
    updatingShadowDispatch: function (dispatchedMethodName, useArgs, translate, args, latlngs) {
        var isSingle = !(this instanceof L.Polyline);
        var llo = this.calcShadow(latlngs);
        var changed = this.changeShadows(llo);
        
        for (var shadowType in this.shadowOptions.shadowShapes) {
            if (this.shadowOptions.shadowShapes.hasOwnProperty(shadowType)) {
                if (changed.hasOwnProperty(shadowType)) {
                    continue;
                }
            
                var shadowShape = this.shadowOptions.shadowShapes[shadowType];
                shadowShape.shadowOptions.secondaryExecutor = true;
                
                var targs = args;
                if (useArgs) {
                    targs = L.ShadowWrap.translateArgs(shadowShape, translate, args);
                }
                else if (useArgs === false) {
                    targs = (isSingle) ? llo.latlngs[shadowType] : [llo.latlngs[shadowType]];
                }
                
                shadowShape[dispatchedMethodName].apply(shadowShape, targs);
                shadowShape.shadowOptions.secondaryExecutor = false;
                
                if (translate !== null) {
                    shadowShape._fixShape();
                }
            }
        }
        
        return llo;
    },
    
    // general helper function to see if we don't need to bother with shadow dispatching, for a variety of reasons
    shadowDispatchChecks: function (className, methodName, dispatchTag, args) {
        var dispatchedMethodName = methodName + '__original' + dispatchTag;
        // if we're not added to the map, or if this shape doesn't have shadow hooks for some reason, bail
        if ((!this._map) || (!this.hasOwnProperty('shadowOptions')) || (!this.shadowOptions.isShape)) {
            return {
                'dispatched': true, 
                'dispatchResult': this[dispatchedMethodName].apply(this, args)
            };
        }
        
        // if this caller of this method is blocked on shadows, pretend we called it and bail
        if (this.shadowOptions.isShadow && L.ShadowWrap.checkExceptions(className, methodName, this)) {
            return {
                'dispatched': true,
                'dispatchResult': this
            };
        }
        
        // if our root call is on the shadow instead of the main shape, kick back up to the main shape
        if (this.shadowOptions.isShadow && (this.shadowOptions.secondaryExecutor === false)) {
            this.shadowOptions.secondaryExecutor = true;
            var primaryRet = this.shadowOptions.mainShape[methodName].apply(this.shadowOptions.mainShape, args);
            this.shadowOptions.secondaryExecutor = false;
            return {
                'dispatched': true, 
                'dispatchResult': primaryRet
            };
        }
        
        // if we've already gone through the main shape, then dispatch 
        
        if (this.shadowOptions.isShadow || this.shadowOptions.shadowSplit) {
            return {
                'dispatched': true,
                'dispatchResult': this[dispatchedMethodName].apply(this, args)
            };
        }
        
        return {'dispatched': false};
    },
    
    // actually create the shadow shape
    _addShadow: function (shadowType, latlngs, restoreFromCache) {
        var cls = Object.getPrototypeOf(this).constructor;
        var shadowShape;
        
        if ((restoreFromCache === true) && this.hasOwnProperty('_shadowCache') && this._shadowCache.hasOwnProperty(shadowType)) {
            shadowShape = this._shadowCache[shadowType][0];
            shadowShape._events = this._shadowCache[shadowType][1];
            shadowShape._map = null;
            delete this._shadowCache[shadowType];
        }
        
        else {
            var shadowOpts = L.extend({}, this.options);
            delete shadowOpts.nonBubblingEvents;
            shadowOpts.isShadow = true;
            
            if (this instanceof L.CircleMarker) {
                shadowShape = new cls(latlngs[0], this.options.radius, shadowOpts);
            }
            else if (this instanceof L.Marker) {
                shadowShape = new cls(latlngs[0], shadowOpts);
            }
            else {
                shadowShape = new cls(latlngs, shadowOpts);
            }
            
            for (var i=0; i<L.ShadowWrap.EventsToShadow.length; i++) {
                var eventName = L.ShadowWrap.EventsToShadow[i];
                this._makeShadowEventHandler(shadowType, shadowShape, eventName);
            }
            
            this.shadowOptions.shadowShapes[shadowType] = shadowShape;
            
            shadowShape.shadowOptions.mainShape = this;
            shadowShape.shadowOptions.isShadow = true;
            shadowShape.shadowOptions.shadowType = shadowType;
        }
        
        shadowShape.addTo(this._map);
        shadowShape._fixShape();
        
        this.fire('shadowAdded', {
            'shadowLayer': shadowShape,
            'shadowType': shadowType
        });
    },
    
    _makeShadowEventHandler: function (shadowType, shadowShape, eventName) {
        var that = this;
        
        shadowShape.on(eventName, function () {
            var args = Array.prototype.slice.call(arguments);
            
            if (args.length > 0) {
                args[0]._shadowDispatched = true;
                args[0]._shadowDispatchType = shadowType;
                args[0]._shadowDispatchShape = shadowShape;
            }
            else {
                args = [{
                    '_shadowDispatched': true,
                    '_shadowDispatchType': shadowType,
                    '_shadowDispatchShape': shadowShape,
                }];
            }
            
            args.unshift(eventName);
            that.fire.apply(that, args);
        }, this);
    },
    
    _fixShape: function () {
        if ('redraw__original' in this) { 
            this._reset__original();
            this.redraw();
        }
        else {
            this.update();
        }
    },
    
    _removeShadowShape: function (shadowType) {
        if (this.shadowOptions.isShadow) {
            return;
        }
        
        var shadowShape = this.shadowOptions.shadowShapes[shadowType];
        if (! this.hasOwnProperty('_shadowCache')) {
            this._shadowCache = {};
        }
        
        var events = shadowShape._events;
        shadowShape.off();
        shadowShape.removeFrom(shadowShape._map);
        this._shadowCache[shadowType] = [shadowShape, events];
        delete this.shadowOptions.shadowShapes[shadowType];
        
        this.fire('shadowRemoved', {
            'shadowLayer': shadowShape,
            'shadowType': shadowShape.shadowOptions.shadowType
        });
    },
    
    // use this to permanently remove shadowing from a shape
    unshadow: function () {
        if (this.options.noShadow) {
            return;
        }
        
        if (this.shadowOptions.isShadow) {
            return this.shadowOptions.mainShape.unshadow();
        }
        
        for (var shadowType in this.shadowOptions.shadowShapes) {
            if (this.shadowOptions.shadowShapes.hasOwnProperty(shadowType)) {
                this._removeShadowShape(shadowType);
            }
        }
        
        delete this.shadowOptions;
            
        this.off('add', this.addShadows, this);
        this.off('remove', this.removeAllShadows, this);
        this.options.noShadow = true;
    },
    
    // use this to restore shadowshapes removed at a previous time via .unshadow()
    // intended for times when you want to temporarily remove shadowshapes for some operation
    reshadow: function () {
        this.unshadow();
        delete this.options.noShadow;
                
        this.shadowOptions = {
            'isShape': true,
            'shadowShapes': {},
            'shadowSplit': false,
            'shadowType': 'normalizeLL',
            'isShadow': false,
            'secondaryExecutor': false,
            'blockChanges': false
        };
        
        this.on('add', this.addShadows, this);
        this.on('remove', this.removeAllShadows, this);
        
        this.addShadows(true);
    },
    
    blockShadowChanges: function () {
        if (this.options.noShadow) {
            return;
        }
        
        if (this.shadowOptions.isShadow) {
            return this.shadowOptions.mainShape.blockShadowChanges();
        }
        
        this.shadowOptions.blockChanges = true;
        for (var shadowType in this.shadowOptions.shadowShapes) {
            if (this.shadowOptions.shadowShapes.hasOwnProperty(shadowType)) {
                this.shadowOptions.shadowShapes[shadowType].blockChanges = true;
            }
        }
    },
    
    unblockShadowChanges: function () {
        if (this.options.noShadow) {
            return;
        }
        
        var shadowType;
        var referenceShape = (this.shadowOptions.isShadow) ? this.shadowOptions.mainShape : this;
        referenceShape.shadowOptions.blockChanges = false;
            
        for (shadowType in referenceShape.shadowOptions.shadowShapes) {
            if (referenceShape.shadowOptions.shadowShapes.hasOwnProperty(shadowType)) {
                referenceShape.shadowOptions.shadowShapes[shadowType].blockChanges = false;
            }
        }
    
        if (this._latlng) {
            referenceShape._latlng = referenceShape.guideLL(this._latlng);
        }
        else {
            referenceShape.setLatLngs(referenceShape.guideLLs(this._latlngs));
        }
        
        for (shadowType in referenceShape.shadowOptions.shadowShapes) {
            if (referenceShape.shadowOptions.shadowShapes.hasOwnProperty(shadowType)) {
                referenceShape.shadowOptions.shadowShapes[shadowType]._fixShape();
            }
        }
        
        referenceShape._fixShape();
    },
});
/* globals L:true */

L.Layer.include({
    calcShadow: function (latlngs) {
        L.ShadowWrap.minimumWrapDistance = Math.abs(L.ShadowWrap.minimumWrapDistance);
        
        var result = {
            'needsShadow': {
                'normalizeLL': false,
                'normLatMirrorLng': false,
                'mirrorLatNormLng': false,
                'mirrorLL': false
            },
            'latlngs': {
                'normalizeLL': [],
                'mirrorLatNormLng': [],
                'normLatMirrorLng': [],
                'mirrorLL': []
            }
        };
        
        result.needsShadow[this.shadowOptions.shadowType] = true;
        result.latlngs[this.shadowOptions.shadowType] = latlngs;
    
        if ((!this._map) || (!this.shadowOptions.isShape)) {
            return result;
        }
        
        result.latlngs[this.shadowOptions.shadowType] = [];
        return this._calcShadow(result, latlngs);
    },
    
    _calcShadow: function (result, latlngs) {
        var crossingInfo = this.detectShadowSpaces(latlngs);
        crossingInfo.center = {'lat': 0, 'lng': 0};
        
        if (this.shadowOptions.blockChanges) {
            crossingInfo.crossLat = this.shadowOptions.shadowShapes.hasOwnProperty('mirrorLatNormLng');
            crossingInfo.crossLng = this.shadowOptions.shadowShapes.hasOwnProperty('normLatMirrorLng');
        }
        
        result.needsShadow.normalizeLL = true;
        
        if (crossingInfo.crossLng) {
            result.needsShadow.normLatMirrorLng = true;
        }
        if (crossingInfo.crossLat) {
            result.needsShadow.mirrorLatNormLng = true;
        }
        if (crossingInfo.crossLat && crossingInfo.crossLng) {
            result.needsShadow.mirrorLL = true;
        }
        
        var wrappedLLs = [];
        var len = 0;
        
        if (crossingInfo.isFlat) {
            wrappedLLs = this.wrapLLs(crossingInfo, latlngs);
            len = wrappedLLs.length;
        }
        else {
            for (var i=0; i<latlngs.length; i++) {
                var subnormLLs = this.wrapLLs(crossingInfo, latlngs[i]);
                wrappedLLs.push(subnormLLs);
                len += subnormLLs.length;
            }
        }
    
        this.calcMirrorInfo(crossingInfo, len);
        this.shadowOptions.crossingInfo = crossingInfo;
        result.latlngs = this.convertLatLngs(wrappedLLs, crossingInfo.isFlat);
        
        return result;
    },
    
    wrapLLs: function (crossingInfo, latlngs) {
        var wrapLLs = [];
        
        for (var i=0; i<latlngs.length; i++) {
            var wrapLL = this._map.options.crs.wrapLatLng(L.latLng(latlngs[i]));
            wrapLLs.push(wrapLL);
            
            if (crossingInfo.crossLat) {
                crossingInfo.center.lat += wrapLL.lat;
            }
            if (crossingInfo.crossLng) {
                crossingInfo.center.lng += wrapLL.lng;
            }
        }
        
        return wrapLLs;
    },
    
    calcMirrorInfo: function (crossingInfo, len) {
        var crs = this._map.options.crs;
        
        crossingInfo.diff = {'lat': 0, 'lng': 0};
        crossingInfo.diffMid = {'lat': 0, 'lng': 0};
        
        if (crossingInfo.crossLat) {
            crossingInfo.diff.lat = Math.abs(crs.wrapLat[1] - crs.wrapLat[0]);
            crossingInfo.diffMid.lat = (crs.wrapLat[1] + crs.wrapLat[0])/2;
            
            crossingInfo.center.lat /= len;
            
            if (crossingInfo.center.lat >= crossingInfo.diffMid.lat) {
                crossingInfo.ca = true;
            }
            else if (crossingInfo.center.lat < crossingInfo.diffMid.lat) {
                crossingInfo.cb = true;
            }
        }
        
        if (crossingInfo.crossLng) {
            crossingInfo.diff.lng = Math.abs(crs.wrapLng[1] - crs.wrapLng[0]);
            crossingInfo.diffMid.lng = (crs.wrapLng[1] + crs.wrapLng[0])/2;
            
            crossingInfo.center.lng /= len;
            if (crossingInfo.center.lng >= crossingInfo.diffMid.lng) {
                crossingInfo.cc = true;
            }
            else if (crossingInfo.center.lng < crossingInfo.diffMid.lng) {
                crossingInfo.cd = true;
            }
        }
        
        return crossingInfo;
    },
    
    convertLatLngs: function (wrapLLs, isFlat) {
        var result = {
            'normalizeLL': [],
            'normLatMirrorLng': [],
            'mirrorLatNormLng': [],
            'mirrorLL': []
        };
      
        var i;
        if (isFlat) {
            for (i=0; i<wrapLLs.length; i++) {
                this.convertLatLng(result, wrapLLs[i]);
            }
        }
        else {
            for (i=0; i<wrapLLs.length; i++) {
                var subResult = this.convertLatLngs(wrapLLs[i], true);
                for (var shadowType in result) {
                    if (result.hasOwnProperty(shadowType)) {
                        result[shadowType].push(subResult[shadowType]);
                    }
                }
            }
        }
        
        return result;
    },
    
    convertLatLng: function (result, latlng) {
        if (this.shadowOptions.crossingInfo.crossLat) {
            result.mirrorLatNormLng.push(this._mirrorLatNormLng(latlng));
        }
        
        if (this.shadowOptions.crossingInfo.crossLng) {
            result.normLatMirrorLng.push(this._normLatMirrorLng(latlng));
        }
        
        if (this.shadowOptions.crossingInfo.crossLat && this.shadowOptions.crossingInfo.crossLng) {
            result.mirrorLL.push(this._mirrorLL(latlng));
        }
        
        result.normalizeLL.push(this._normalizeLL(latlng));
    },
    
    // ******************************************************************************
    // ******************************************************************************
    
    checkWrapZone: function (llv, LLradius, crossPoints) {
        var side0 = this._checkWrapZone(llv, LLradius, crossPoints[0]);
        if (side0) {
            return true;
        }
        
        return this._checkWrapZone(llv, LLradius, crossPoints[1]);
    },
    
    // check to see if a circle is on two sides of a wrap line (or within the bonus wrap zone)
    // if LLradius = 0, we're checking a point, not a circle
    _checkWrapZone: function (llv, LLradius, crossPoint) {
        var d = llv - crossPoint;
        
        var dA = d - LLradius;
        var dB = d + LLradius;
        
        var crossA = (dA <= L.ShadowWrap.minimumWrapDistance) && (dB > -L.ShadowWrap.minimumWrapDistance);
        var crossB = (dB <= L.ShadowWrap.minimumWrapDistance) && (dA > -L.ShadowWrap.minimumWrapDistance);
        
        return (crossA || crossB);
    },
    
    normalizeLL: function (rawLatLng) {
        var latlng = this._map.options.crs.wrapLatLng(L.latLng(rawLatLng));
        return this._normalizeLL(latlng);
    },

    _normalizeLL: function (latlng) {
        var lat = this._normLat(latlng.lat);
        var lng = this._normLng(latlng.lng);
        return new L.LatLng(lat, lng);
    },

    normLatMirrorLng: function (rawLatLng) {
        var latlng = this._map.options.crs.wrapLatLng(L.latLng(rawLatLng));
        return this._normLatMirrorLng(latlng);
    },

    _normLatMirrorLng: function (latlng) {
        var lat = this._normLat(latlng.lat);
        var lng = this._mirrorLng(latlng.lng);
        return new L.LatLng(lat, lng);
    },
    
    mirrorLatNormLng: function (rawLatLng) {
        var latlng = this._map.options.crs.wrapLatLng(L.latLng(rawLatLng));
        return this._mirrorLatNormLng(latlng);
    },
    
    _mirrorLatNormLng: function (latlng) {
        var lat = this._mirrorLat(latlng.lat);
        var lng = this._normLng(latlng.lng);
        return new L.LatLng(lat, lng);
    },
    
    mirrorLL: function (rawLatLng) {
        var latlng = this._map.options.crs.wrapLatLng(L.latLng(rawLatLng));
        return this._mirrorLL(latlng);
    },
    
    _mirrorLL: function (latlng) {
        var lat = this._mirrorLat(latlng.lat);
        var lng = this._mirrorLng(latlng.lng);
        return new L.LatLng(lat, lng);
    },
    
    _normLat: function (lat) {
        if (this.shadowOptions.crossingInfo.ca && (lat < this.shadowOptions.crossingInfo.diffMid.lat)) {
            lat += this.shadowOptions.crossingInfo.diff.lat;
        }
        else if (this.shadowOptions.crossingInfo.cb && (lat >= this.shadowOptions.crossingInfo.diffMid.lat)) {
            lat -= this.shadowOptions.crossingInfo.diff.lat;
        }
        
        return lat;
    },
    
    _normLng: function (lng) {
        if (this.shadowOptions.crossingInfo.cc && (lng < this.shadowOptions.crossingInfo.diffMid.lng)) {
            lng += this.shadowOptions.crossingInfo.diff.lng;
        }
        else if (this.shadowOptions.crossingInfo.cd && (lng > this.shadowOptions.crossingInfo.diffMid.lng)) {
            lng -= this.shadowOptions.crossingInfo.diff.lng;
        }
        
        return lng;
    },
    
    _mirrorLat: function (lat) {
        if (this.shadowOptions.crossingInfo.cb && (lat < this.shadowOptions.crossingInfo.diffMid.lat)) {
            lat += this.shadowOptions.crossingInfo.diff.lat;
        }
        else if (this.shadowOptions.crossingInfo.ca && (lat > this.shadowOptions.crossingInfo.diffMid.lat)) {
            lat -= this.shadowOptions.crossingInfo.diff.lat;
        }
        
        return lat;
    },
    
    _mirrorLng: function (lng) {
        if (this.shadowOptions.crossingInfo.cd && (lng < this.shadowOptions.crossingInfo.diffMid.lng)) {
            lng += this.shadowOptions.crossingInfo.diff.lng;
        }
        else if (this.shadowOptions.crossingInfo.cc && (lng > this.shadowOptions.crossingInfo.diffMid.lng)) {
            lng -= this.shadowOptions.crossingInfo.diff.lng;
        }
        
        return lng;
    },
        
    // ******************************************************************************
    // ******************************************************************************
    
    // take a coordinate and put it in proper context for this shape
    guideLL: function (rawLatLng) {
        if (this.options.noShadow) {
            return rawLatLng;
        }
    
        var referenceShape = (this.shadowOptions.isShadow) ? this.shadowOptions.mainShape : this;
        
        if (!referenceShape.shadowOptions.hasOwnProperty('crossingInfo')) {
            this.calcShadow();
        }
        
        return referenceShape[this.shadowOptions.shadowType](rawLatLng);
    },
        
    guideLLs: function (rawLatLngs) {
        if (this.options.noShadow) {
            return rawLatLngs;
        }
    
        var referenceShape = (this.shadowOptions.isShadow) ? this.shadowOptions.mainShape : this;
        var isSingle = !(this instanceof L.Polyline);
        referenceShape.calcShadow((isSingle) ? [this._latlng] : this._latlngs);
        
        var i;
        var latlng;
        var guided = [];
        
        if (referenceShape.shadowOptions.crossingInfo.isFlat) {
            for (i=0; i<rawLatLngs.length; i++) {
                latlng = referenceShape[this.shadowOptions.shadowType](rawLatLngs[i]);
                guided.push(latlng);
            }
        }
        else {
            for (var j=0; j<rawLatLngs.length; j++) {
                var subGuided = [];
                for (i=0; i<rawLatLngs[j].length; i++) {
                    latlng = referenceShape[this.shadowOptions.shadowType](rawLatLngs[j][i]);
                    subGuided.push(latlng);
                }
                
                guided.push(subGuided);
            }
        }
        
        return guided;
    }
});

/*
    implement a "detectShadowSpaces" for each layer-type class, which determines if there should exist
    a shadow near each wrap axis
*/

L.Marker.include({
    detectShadowSpaces: function (latlngs) {
        var ll = L.latLng(latlngs[0]);
        var crossingInfo = {
            'crossLat': false,
            'crossLng': false,
            'isFlat':  true
        };
        
        if (this._map.options.crs.hasOwnProperty('wrapLat')) {
            crossingInfo.crossLat = this.checkWrapZone(ll.lat, 0, this._map.options.crs.wrapLat);
        }
        
        if (this._map.options.crs.hasOwnProperty('wrapLng')) {
            crossingInfo.crossLng = this.checkWrapZone(ll.lng, 0, this._map.options.crs.wrapLng);
        }
        
        return crossingInfo;
    }
});

L.CircleMarker.include({
    detectShadowSpaces: function (latlngs) {
        var ll = L.latLng(latlngs[0]);
        var crossingInfo = {
            'crossLat': false,
            'crossLng': false,
            'isFlat':  true
        };
        
        var LLradius = this.getLLRadius();
        
        if (this._map.options.crs.hasOwnProperty('wrapLat')) {
            crossingInfo.crossLat = this.checkWrapZone(ll.lat, LLradius, this._map.options.crs.wrapLat);
        }
        
        if (this._map.options.crs.hasOwnProperty('wrapLng')) {
            crossingInfo.crossLng = this.checkWrapZone(ll.lng, LLradius, this._map.options.crs.wrapLng);
        }
        
        return crossingInfo;
    },
    
    getLLRadius: function () {
        var radius = this.getRadius();
    
        if (this instanceof L.Circle) {
            // circle uses a radius in kilometers on earth maps
            if (this._map.options.crs.hasOwnProperty('R') && (this._map.options.crs.R !== null)) {
                return radius*(180/Math.PI/this._map.options.crs.R);
            }
            
            return radius;
        }
        
        else { // circlemarker gives a radius in pixels
            return Math.abs(this._map.unproject([radius, 0]).lng - this._map.unproject([0, 0]).lng);
        }
        
        return radius;
    }
});

L.Polyline.include({
    detectShadowSpaces: function (latlngs) {
        var crossingInfo = {
            'crossLat': false,
            'crossLng': false,
            'isFlat':  L.LineUtil.isFlat(latlngs)
        };
        
        if (crossingInfo.isFlat) {
            if (this._map.options.crs.hasOwnProperty('wrapLat')) {
                crossingInfo.crossLat = this._detectShadowSpaces('lat', latlngs, this._map.options.crs.wrapLat);
            }
            
            if (this._map.options.crs.hasOwnProperty('wrapLng')) {
                crossingInfo.crossLng = this._detectShadowSpaces('lng', latlngs, this._map.options.crs.wrapLng);
            }
        }
        else {
            for (var i=0; i<latlngs.length; i++) {
                var innerCrossingInfo = this.detectShadowSpaces(latlngs[i]);
                crossingInfo.crossLat = crossingInfo.crossLat || innerCrossingInfo.crossLat;
                crossingInfo.crossLng = crossingInfo.crossLng || innerCrossingInfo.crossLng;
            }
        }
        
        return crossingInfo;
    },
    
    _detectShadowSpaces: function (coordType, latlngs, crossPoints) {
        var pointLeft = false;
        var pointRight = false;
        
        var meridian = (crossPoints[0] + crossPoints[1])/2;
        var meridianLeft = meridian - L.ShadowWrap.minimumWrapDistance;
        var meridianRight = meridian + L.ShadowWrap.minimumWrapDistance;
        
        var OKzoneLeft = crossPoints[0]/2;
        var OKzoneRight = crossPoints[1]/2;
        
        var forceZoneLeft = crossPoints[0] + L.ShadowWrap.minimumWrapDistance;
        var forceZoneRight = crossPoints[1] - L.ShadowWrap.minimumWrapDistance;
        
        // algorithm we're looking for either a.) at least one point on each side of the antimeridian,
        // or b.) at least one point within the range between the antimeridian and L.ShadowWrap.minimumWrapDistance
        for (var i=0; i<latlngs.length; i++) {
            var ll = L.latLng(latlngs[i]);
            var llv = L.Util.wrapNum(ll[coordType], crossPoints, true);
            
            if ((llv <= forceZoneLeft) || (llv >= forceZoneRight)) {
                return true;
            }
            
            // if a point is closer to the prime meridian than the antimeridian, we ignore it
            if ((llv >= OKzoneLeft) && (llv <= OKzoneRight)) {
                continue;
            }
        
            if (llv < meridianRight) {
                pointLeft = true;
            }
            if (llv > meridianLeft) {
                pointRight = true;
            }
        }
        
        return pointLeft && pointRight;
    }
});
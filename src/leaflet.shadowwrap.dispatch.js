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
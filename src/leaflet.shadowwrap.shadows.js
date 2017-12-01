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
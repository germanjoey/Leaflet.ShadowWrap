/* globals L:true */

// *************************************************************************************
// *************************************************************************************
// various fiddly things to get leaflet.draw to work correctly with leaflet.shadowwrap

L.ShadowWrap.EventsToShadow.push('move');
L.ShadowWrap.EventsToShadow.push('edit');
L.ShadowWrap.EventsToShadow.push('resize');
L.ShadowWrap.EventsToShadow.push('editstart');

L.ShadowWrap.Draw = {

    shadowTypes: ['normalizeLL', 'normLatMirrorLng', 'mirrorLatNormLng', 'mirrorLL'],

    // propagate edit changes done to a main shape to the shadows, and vice versa
    shadowHooks: function (type, shape, skip) {
        if ((!shape.editing) || (!shape.shadowOptions)) {
            return;
        }
        
        if (shape.shadowOptions.isShadow) {
            L.ShadowWrap.Draw.shadowUpdate(type, shape, shape.shadowOptions.mainShape);
            L.ShadowWrap.Draw.shadowHooks(type, shape.shadowOptions.mainShape, shape.shadowOptions.shadowType);
            return;
        }
            
        for (var shadowType in shape.shadowOptions.shadowShapes) {
            if (shape.shadowOptions.shadowShapes.hasOwnProperty(shadowType)) {
                if (skip == shadowType) {
                    continue;
                }
                
                L.ShadowWrap.Draw.shadowUpdate(type, shape, shape.shadowOptions.shadowShapes[shadowType]);
            }
        }
    },
    
    // add hooks to update the shadow/main shape as vice versa is edited and/or drawn
    initializeShadowHooks: function () {
        if (this.options.noShadow) {
            return;
        }
        
        if (this.shadowOptions.isShadow) {
            return;
        }
        
        var that = this;
        
        // we block changes to the shadowing while a shape is being dragged (resized or moved)
        // and then unblock when shadowing is done. we know when this is happened via the
        // 'move', 'resize', or 'edit' events, depending on the shape 
        var h = function (e) {
            if (!that.shadowOptions || that.options.noShadow) {
                return;
            }
            
            // circle and marker move will fire on 'move', not 'edit'
            if (!(that instanceof L.Polyline) && (e.type == 'move')) {
                that.unblockShadowChanges();
            }
            
            // circle/resize, rectangle, and any of the vertex edits 
            if (e.type == 'edit') {
                that.unblockShadowChanges();
                if (that instanceof L.CircleMarker) {
                    var resizeMarkerLL = that.editing._resizeMarkers[0]._latlng;
                    that.setLatLng(that._latlng);
                    that.editing._resizeMarkers[0]._latlng = resizeMarkerLL;
                    that.editing._resizeMarkers[0].update();
                }
            }
            
            // once we're done, update
            if (! that.shadowOptions.blockChanges) {
                var target = that;
                if (e._shadowDispatched) {
                    target = e._shadowDispatchShape;
                }
            
                L.ShadowWrap.Draw.shadowHooks(e.type, target);
            }
            
            if (that._focusNextUpdate) {
                if ((that instanceof L.Marker) || (e.type == 'edit')) {
                    L.ShadowWrap.Draw.focusUpdate(that);
                    L.ShadowWrap.Draw.resetMoveMarkers(that);
                    L.ShadowWrap.Draw.resetCircleResizer(that);
                }   
            }
            
        };
        
        this.on('move', h);
        this.on('resize', h);
        this.on('edit', h);
        
        // after an edit operation, its possible that a shape that had a shadow
        // will now lose it. thus, we need to do some surgery to prevent leaflet draw from
        // freaking out that a shape it thought it was handling is now gone
        this.on('shadowRemoved', function (e) {
            if (e.shadowLayer.hasOwnProperty('editing')) {
                var mainShape = e.shadowLayer.shadowOptions.mainShape;
                e.shadowLayer.fire = L.ShadowWrap.Draw.makeFakeFirer(e.shadowLayer, mainShape, mainShape);
                e.shadowLayer._map = L.Util.extend(mainShape._map);
                e.shadowLayer.editing._map = L.Util.extend(mainShape._map);
                mainShape._focusNextUpdate = true;
            }
        });
        
        // all edit operations will always fire 'editstart' on a shape at the beginning of a drag
        this.on('editstart', function (e) {
            if (that.hasOwnProperty('_focusNextUpdate')) {
                delete that._focusNextUpdate;
            }
            
            // events on a shape are always forwarded to the main shape, so we've gotta figure out
            // if we were actually called on a shadow or not
            if (e._shadowDispatched || (Object.keys(that.shadowOptions.shadowShapes).length !== 0)) {
                that.blockShadowChanges();
            }
        });
        
        var clearOnFinish = function (e) {
            if (that.hasOwnProperty('_focusNextUpdate')) {
                delete that._focusNextUpdate;
            }
        };
        
        if (this._map) {
            this._map.on(L.Draw.Event.CANCELED, clearOnFinish);
            this._map.on(L.Draw.Event.EDITDONE, clearOnFinish);
        }
        else {
            this.on('add', function () {
                that._map.on(L.Draw.Event.CANCELED, clearOnFinish);
                that._map.on(L.Draw.Event.EDITDONE, clearOnFinish);
            });
        }
    },
    
    // during edit mode, when a shadow-shape is moved to outside of the wrap-zone, it 
    // will disappear at the moment dragging has stopped. so we pan to the main shape
    // so that the user doesn't think the shape has evaporated.
    focusUpdate: function (layer) {
        if (layer._latlng) {
            layer._map.panTo(layer._latlng);
        }
        else {
            layer._map.panTo(layer.getBounds().getCenter());
        }
    
        delete layer._focusNextUpdate;
    },
    
    
    resetMoveMarkers: function (layer) {
        if (layer.editing._moveMarker) {
            layer.editing._moveMarker.setLatLng(layer.guideLL(layer.getBounds().getCenter()));
            layer.editing._moveMarker.update();
        }
    },
    
    resetCircleResizer: function (layer1, layer2) {
        if (layer1.editing._getResizeMarkerPoint) {
            layer1.editing._resizeMarkers[0].setLatLng(layer1.guideLL(layer1.editing._resizeMarkers[0]._latlng));
            layer1.editing._resizeMarkers[0].update();
            
            if (layer2) {
                var resizePoint = layer2.editing._getResizeMarkerPoint(layer2.getBounds().getCenter()); 
                layer2.editing._resizeMarkers[0].setLatLng(layer2.guideLL(resizePoint));
                layer2.editing._resizeMarkers[0].update();
            }
        }
    },
    
    // for edit mode: when an edit happens on either the main shape or the shadow shape,
    // we propagate changes to the leaflet-draw-markers (i.e. the move marker and the resize markers)
    // on the mirror
    shadowUpdate: function (type, refShape, shape) {
        if (shape.options.noShadow) {
            return;
        }
    
        if (shape instanceof L.Marker) {
            if (shape.hasOwnProperty('_originalLatLng') && !refShape.hasOwnProperty('_originalLatLng')) {
                refShape._originalLatLng = refShape.guideLL(shape._originalLatLng);
                refShape.setLatLng(refShape.guideLL(shape._latlng));
                refShape.update();
            }
            else if (refShape.hasOwnProperty('_originalLatLng') && !shape.hasOwnProperty('_originalLatLng')) {
                shape._originalLatLng = shape.guideLL(refShape._originalLatLng);
                shape.setLatLng(shape.guideLL(refShape._latlng));
                shape.update();
            }
            
            return;
        }
        
        L.ShadowWrap.Draw.resetMoveMarkers(shape);
        L.ShadowWrap.Draw.resetMoveMarkers(refShape);
        
        // for polyines/polygons; gotta do it twice here
        if (!(shape instanceof L.Rectangle) && (shape instanceof L.Polyline)) {
            refShape._setLatLngs(refShape._latlngs);
            L.ShadowWrap.Draw.fixEditMarkers(shape, shape.editing);
            L.ShadowWrap.Draw.fixEditMarkers(refShape, refShape.editing);
            
            shape.editing.updateMarkers();
            L.ShadowWrap.Draw.fixEditMarkers(shape, shape.editing);
            L.ShadowWrap.Draw.fixEditMarkers(refShape, refShape.editing);
        
            return;
        }
        
        // rectangle
        if (shape.editing._repositionCornerMarkers) {
            shape.editing._repositionCornerMarkers();
            return;
        }
        
        
        // circle
        L.ShadowWrap.Draw.resetCircleResizer(refShape, shape);
    },
    
    // fix the resize/move markers created by leaflet draw by removing their shadow-versions
    // that is to say, if we have one shape with one mirror, we don't want 4 sets of markers
    fixEditMarkers: function (shape, editHandler) {
        if (shape instanceof L.Marker) {
            return;
        }
        
        var leafletId;
        if (editHandler._markerGroup) {
            for (leafletId in editHandler._markerGroup._layers) {
                if (editHandler._markerGroup._layers.hasOwnProperty(leafletId)) {
                    L.ShadowWrap.Draw.fixDrawMarker(shape, editHandler._markerGroup._layers[leafletId]);
                }
            }
        }
        
        // for polylines/polygons, which have those extra middle markers between vertexes
        // to allow the user to add more points to a shape
        if (editHandler._verticesHandlers) {
            for (var i=0; i<editHandler._verticesHandlers.length; i++) {
                var vHmG = editHandler._verticesHandlers[i]._markerGroup;
                if (! vHmG) {
                    continue;
                }
                
                for (leafletId in vHmG._layers) {
                    if (vHmG._layers.hasOwnProperty(leafletId)) {
                        L.ShadowWrap.Draw.fixDrawMarker(shape, vHmG._layers[leafletId]);
                    }
                }
            }
        }
    },
    
    // similar for edit-markers, but for drawing polyines/polygons
    fixDrawMarker: function (shape, marker) {
        if (! shape.options.noShadow) {
            marker._latlng = shape.guideLL(marker._latlng);
            marker.update();
        }
        
        marker.unshadow();
    },
    
    // hook into leaflet.draw and leaflet.snap: add and remove shadow layers to drawnitems and the
    // guideLayers as each such action is performed on the main shape.
    processDrawnItem: function (drawControl, drawnItems, snapGuideLayers, layer) {
        drawnItems.addLayer(layer);
        if (snapGuideLayers) {
            snapGuideLayers.push(layer);
        }
        
        if (layer.hasOwnProperty('shadowOptions')) {
            for (var shadowType in layer.shadowOptions.shadowShapes) {
                if (layer.shadowOptions.shadowShapes.hasOwnProperty(shadowType)) {
                    var shadowShape = layer.shadowOptions.shadowShapes[shadowType];
                    
                    drawnItems.addLayer(shadowShape);
                    if (snapGuideLayers) {
                        snapGuideLayers.push(shadowShape);
                    }
                }
            }
        }
        
        layer.on('shadowAdded', function (e) {
            drawnItems.addLayer(e.shadowLayer);
            if (snapGuideLayers) {
                snapGuideLayers.push(e.shadowLayer);
            }
        });
        
        layer.on('shadowRemoved', function (e) {
            drawnItems.removeLayer(e.shadowLayer);
            
            // remove from snap
            if (snapGuideLayers) {
                var slid = L.stamp(e.shadowLayer);
                
                for (var i=0; i<snapGuideLayers.length; i++) {
                    if (L.stamp(snapGuideLayers[i]) == slid) {
                        snapGuideLayers.splice(i, 1);
                        break;
                    }
                }
            }
            
            // fix l.draw.undomanager; when a shadow is deleted, we replace all mention in the event history
            // with the mainshape instead
            var mainShape = e.shadowLayer.shadowOptions.mainShape;
            if (drawControl.undoManager.editHandlerIndex.hasOwnProperty(e.shadowLayer._leaflet_id)) {
                if (drawControl.undoManager.editHandlerIndex.hasOwnProperty(mainShape._leaflet_id)) {
                    drawControl.undoManager.editHandlerIndex[e.shadowLayer._leaflet_id] = drawControl.undoManager.editHandlerIndex[mainShape._leaflet_id];
                }
                else {
                    drawControl.undoManager.editHandlerIndex[e.shadowLayer._leaflet_id] = mainShape._editing;
                    drawControl.undoManager.editHandlerIndex[mainShape._leaflet_id] = mainShape._editing;
                }
            }
            
            if (drawControl.undoManager.editHandlerIndex.hasOwnProperty('v' + e.shadowLayer._leaflet_id)) {
                if (drawControl.undoManager.editHandlerIndex.hasOwnProperty('v' + mainShape._leaflet_id)) {
                    drawControl.undoManager.editHandlerIndex['v' + e.shadowLayer._leaflet_id] = drawControl.undoManager.editHandlerIndex[mainShape._leaflet_id];
                }
                else {
                    drawControl.undoManager.editHandlerIndex['v' + e.shadowLayer._leaflet_id] = mainShape._editing._verticesHandlers[0];
                    drawControl.undoManager.editHandlerIndex['v' + mainShape._leaflet_id] = mainShape._editing._verticesHandlers[0];
                }
            }
            
            var stackTypes = ['undoStack', 'redoStack'];
            for (var j=0; j<stackTypes.length; j++) {
                var stackType = stackTypes[j];
                for (var k=0; k<drawControl.undoManager.stateHandler[stackType].length; k++) {
                    var item = drawControl.undoManager.stateHandler[stackType][k];
                    if (item.params.layer._leaflet_id == e.shadowLayer._leaflet_id) {
                        item.params.layer = mainShape;
                    }
                }
            }
        });
    },
    
    hookCallbacks: function (drawControl, drawnItems, snapGuideLayers) {
        drawnItems._map.on(L.Draw.Event.CREATED, function (e) {
            if (e.layer.options.noShadow) {
                e.layer.addShadows();
            }
        
            L.ShadowWrap.Draw.processDrawnItem(drawControl, drawnItems, snapGuideLayers, e.layer);
        });
        
        drawnItems._map.on(L.Draw.Event.EDITHOOK, function (e) {
            L.ShadowWrap.Draw.fixEditMarkers(e.layer, e.editHandler);
        });
        
        drawnItems._map.on(L.Draw.Event.DRAWVERTEX, function (e) {
            var layer = e.drawHandler._poly;
            if (! layer.options.noShadow) {
                layer.unshadow();
            }
            
            var i = e.drawHandler._markers.length - 1;
            var latestMarker = e.drawHandler._markers[i];
            latestMarker._latlng = layer._latlngs[i];
            latestMarker.unshadow();
            latestMarker.update();
        });
        
        drawnItems._map.on(L.Draw.Event.DRAWSTART, function (e) {
            var handler = L.toolbar._toolbars.draw._modes[e.layerType].handler;
            if (handler._mouseMarker) {
                handler._mouseMarker.unshadow();
            }
        });
        
    },
    
    // the main export - to be called from your main.js, or whatever
    hookLeafletDraw: function (drawControl, drawnItems, snapGuideLayers, initialShapeList) {
        if ((initialShapeList === null) || (typeof(initialShapeList) == 'undefined')) {
            initialShapeList = [];
        }
        
        for (var i=0; i<initialShapeList.length; i++) {
            L.ShadowWrap.Draw.processDrawnItem(drawControl, drawnItems, snapGuideLayers, initialShapeList[i]);
        }
        
        if (drawnItems._map) {
            L.ShadowWrap.Draw.hookCallbacks(drawControl, drawnItems, snapGuideLayers);
        }
        else {
            drawnItems.on('add', function () {
                L.ShadowWrap.Draw.hookCallbacks(drawControl, drawnItems, snapGuideLayers);
            });
        }
        
        
    }
};

L.ShadowWrap.hookLeafletDraw = L.ShadowWrap.Draw.hookLeafletDraw;

// when a shadowed shape is dragged outside of the "wrap zone" during edit mode, it will 
// be  deleted once the post-drag event (e.g. move/resize/edit) is fired by the corresponding
// _onDragEnd/_markerDragEnd/whatever event. however, this will happen in the *middle* of the
// leaflet-draw method, which generally causes the rest of the method to break, i.e. the editing
// object gets detached from the shadow shape, as does the map, etc, and thus we're no longer
// able to fire the events we need to. so, we instead hook up a fake event-forwarder to parts
// of the shadowshape to instead forward these events to the main shape when needed
//
// note that this fake-firer is basically only valid until the end of the current l.draw
// operation that resulted in the shadow's removal

L.ShadowWrap.Draw.makeFakeFirer = function (replacedObj, newContext, replacementObj) {
    return function (type, data, propagate) {
        if (type.startsWith('draw:')) {
            if (type == L.Draw.Event.EDITVERTEX) {
                var index = data.marker._index;
                data.marker = replacementObj.editing._verticesHandlers[0]._markers[index];
            }
        
            if (data.hasOwnProperty('layer') && data.layer._leaflet_id == replacedObj._leaflet_id) {
                data.layer = replacementObj;
                
                if (data.hasOwnProperty('editHandler')) {
                    if (data.vertex) {
                        data.editHandler = replacementObj.editing._verticesHandlers[0];
                    }
                    else {
                        data.editHandler = replacementObj.editing;
                    }
                }
            }
            
            if (data.hasOwnProperty('poly') && data.poly._leaflet_id == replacedObj._leaflet_id) {
                data.poly = replacementObj;
            }
            
            if (data.hasOwnProperty('layers')) {
                for (var i=0; i<data.layers.length; i++) {
                    var layer = data.layers[i];
                    if (layer.hasOwnProperty('_leaflet_id') && (layer._leaflet_id == replacedObj._leaflet_id)) {
                        data.layers[i] = replacementObj;
                    }
                }
            }
        }
        
        return L.Evented.prototype.fire.call(newContext, type, data, propagate);
    };
};
    
// when a shadow is existant when edit mode starts, and then an edit occurs wheich causes the shadow to be
// removed, and then edit-mode is saved or canceled, an error will be thrown when L.Draw tries to run
// removeHooks on the now non-existant (or rather, not-attached-to-the-map) shadowshape. this patch fixes
// that problem.
L.EditToolbar.Edit.prototype.__original_disableLayerEdit = L.EditToolbar.Edit.prototype._disableLayerEdit;
L.EditToolbar.Edit.prototype._disableLayerEdit = function (e) {
    var layer = e.layer || e.target || e;
    
    if (layer._map) {
        try {
            if (! layer.hasOwnProperty('dragging')) {
                layer.dragging = {'disable': function () {}};
                this.__original_disableLayerEdit(e);
                delete layer.dragging;
            }
            else {
                this.__original_disableLayerEdit(e);
            }
        }
        catch (err) {}
    }
};

L.ShadowWrap.addExtension('Leaflet.ShadowWrap.Draw', function () {
    L.Marker.addInitHook(L.ShadowWrap.Draw.initializeShadowHooks);
    L.CircleMarker.addInitHook(L.ShadowWrap.Draw.initializeShadowHooks);
    L.Polyline.addInitHook(L.ShadowWrap.Draw.initializeShadowHooks);
    
    // if a shadow is removed via an edit in edit mode and then edit-mode
    // is canceled, revert will throw an error trying to restore the style
    // of an non-existant shape
    var originalRevertLayers = L.EditToolbar.Edit.prototype._revertLayers;
    L.EditToolbar.Edit.prototype._revertLayers = function (layer, isSubLayer) {
        if (layer.hasOwnProperty('shadowOptions') && layer.shadowOptions.isShadow) {
            return;
        }
        
        originalRevertLayers.call(this, layer, isSubLayer);
    };

    // block shadow-calling on setStyle, as it will essentially cause the edit-style to
    // overwrite the main style upon leaving edit mode, and vice-versa
    L.ShadowWrap.addShadowException('L.Path', 'setStyle', L.Edit.SimpleShape.prototype.removeHooks);
    L.ShadowWrap.addShadowException('L.Path', 'setStyle', L.Edit.PolyVerticesEdit.prototype.removeHooks);
});

L.Edit.PolyVerticesEdit.prototype._getMiddleLatLng = function (marker1, marker2) {
    var map = this._poly._map,
        p1 = map.project(this._poly._latlngs[0][marker1._index]),
        p2 = map.project(this._poly._latlngs[0][marker2._index]);

    return map.unproject(p1._add(p2)._divideBy(2));
};
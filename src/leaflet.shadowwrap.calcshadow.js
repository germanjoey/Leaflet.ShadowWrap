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
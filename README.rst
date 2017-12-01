===============
Leaflet.ShadowWrap
===============

This plugin helps solve the problem of geometries trying to span the wrap lines of a map, such as the International Dateline. Simply put, Leaflet doesn't really do it right without some help. Naively specifying the coordinates might cause a small shape to span backwards across the entire globe, or split and cross-cross upon itself, and it is likely that the shape might appear or disappear based on how you pan towards the shape. However, it isn't too difficult to fix this problem by hand. First, set worldCopyJump to true, then normalize your coordinates, and then finally duplicate shapes crossing a wrap line onto both sides of it. What becomes complicated is managing this mess of shapes, especially if they happen to be generated deep inside some plugin or happen to trigger events. Leaflet.ShadowWrap helps you out by transparently hooking into Leaflet's geometric classes (e.g. L.Polygon, L.Rectangle, etc) and adding code that will automatically create a "shadow" version of a shape, if necessary, that will exists on both sides of the dateline. Compare demos 1 and 2 for an example.

----------------
Usage
----------------

Very simple. First include leaflet.shadowwrap.js or leaflet.shadowwrap.min.js in your script and then call:

  L.ShadowWrap.initialize();  
  
at some point before you create your map to transparently hook the shadowing functionality into all leaflet geometries. A shadow shape will be created if it happens to span a wrap line (i.e. the IDL, but this will also work if you have a weird map that wraps in other ways). If you have your own custom geometries, or some sort of custom methods you are extending the existing geometries with, then please read the large comment at the top of the unminified source code for how to hook your own stuff in.

Also remember to add the "worldCopyJump: true" option to the map when you create it.

Another thing you may want control over is whether you want shapes that are *near* the wrap line, but don't cross it, to be shadowed as well, as in the ordinary case leaflet will clip these from view when the map's view crosses the dateline. Thus, you can set L.ShadowWrap.minimumWrapDistance to a nonzero value to extend shadow wrapping to these shapes.

Finally, if there's a shape that you do not want shadowed, for whatever reason, then simply pass in the option "noShadow: true" to its constructor.

-------------------
Feedback and issues
-------------------

Please post any bugs you find with a corresponding fiddle so that I can see the bug in action, or else I will probably ignore you. Please note that "Leaflet.ShadowWrap does not work with plugin X" is not a bug. I will support integration with some plugins, such as Leaflet.draw, for which this plugin was originally created for, if I personally need them. Of course, PRs are welcome.

Leaflet.ShadowWrap should work with most code that creates and manipulates geometries in leaflet as long as they only interface with the shapes via the builtin api methods. Some plugins, however, may need a few extra hooks. For example, Leaflet.draw has code that adds markers to the corners/vertices of shapes when in edit mode to allow the user to stretch or skew them via click and drag. Since Leaflet.draw loops through these coordinates manually, a small bit of extra hooking was necessary to fix up these markers. Likewise, the mouse marker that is created when one draws a polyline/polygon needed to have its shadowing removed.

-------------------
Demo
-------------------

The first demo shows the situation without Leaflet.ShadowWrap. For example, pan to the left and watch the shapes disappear. Or try drawing over the dateline. Also notice how the rectangle wraps across the world long-wise instead of displaying compactly across the dateline.

_Demo 1: https://germanjoey.github.io/leaflet.shadowwrap/demos/demo2.html

This second demo shows Leaflet.ShadoWrap fixing the above.

_Demo 2: https://germanjoey.github.io/leaflet.shadowwrap/demos/demo2.html
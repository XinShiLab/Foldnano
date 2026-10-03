## Notes about the data model

All operations to the model should be done through the only instance of `FoldnanoDocument`, and through its Parts property.
In another word, `Part` is the only thing that is accessible by the View

Three public-facing classes are as follow:

`Part` creates, manages, and deletes `VirtualHelices` and `Oligos`. And only `Part` should do this

in `Part` you can access properties `oligo` and `virtualHelices`

`Oligo` can be broken (on given segment and index), connected (through its primeEnds), resized (set new index for its primeEnd)

`VirtualHelix` knows the segments it owns, and its `StrandSet` know about the space occupied by them

There are two way to access a `OligoSegment`: through its owning `VirtualHelix` or through its owning `Oligo`. When destroy a segment, it will be removed from both

a `OligoSegment` knows which `VH` it belongs to (relation is fix at creation), but not which `Oligo` (relation is dynamic because of connecting and breaking operations)

Passing objects in Javascript/Typescript is essentially passing their references. Therefore, the objects are passed to the functions directly if possible, unless in query methods, where the indices are passed in and the object is returned. The id (a UUID string) is generally not used for query objects, but mainly as a key for UI

connections between segments are managed by their ends through \_.connectedSegment

### Operation is handled by which data model?

### Operation is handled by which UI component?

### All moving operations are moving Ends

**Moving free ends:** naturally you operate on those SegmentEnds, it will determine if they are constrained, if they can be move to certain positions, etc
**Moving a connection/unconstrained connection:** to prevent mistake, which happens to me all the time, unconstrained connections are not allow to move, but you can move individual ends separately  
**Moving a constrained crossover:** practically moving two ends of the crossover together, and only potential crossover sites are allowed
**Moving a segment:** moving the both 3' and 5' end together if they don't have constrained crossovers, otherwise also need to move constrained the other end, then only potential crossover sites are allowed
**moving the entire oligo:** moving all internal and external ends together. If there are constrained crossover within the oligo, only potential crossover sites are allowed

## other notes:

`utils` no matter where they are, they should be pure functions.

`hitMixed` uses a mixed approach to determine the click target: on grid it uses the data model, where Part caches the rsp(row, strand, (bp)position) -> segment map and end map. We are not directly using Konvajs's hit tester because on VH grid, there often are multiple objects overlapping: click a cell, it should return the segment, the end (if it is), oligo, rsp position/grid a the same time. With native Konvajs, `getAllIntersections` can be used but it requires a redraw on a temporal canvas and can have performance issues according to the dot. For other things that are not on the grid (doesn't correspond to a rsp coordinate), the Konva listener is used, and the target info is stored in the `id` field with certain formats:
crossovers: `XOVER#id-of-the-from-segment#to#id-of-the-to-segment`

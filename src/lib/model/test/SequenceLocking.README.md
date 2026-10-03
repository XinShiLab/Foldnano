# Sequence Locking Tests

This test suite covers the sequence locking functionality for DNA origami design in foldnano.

## Overview

The sequence locking mechanism helps track whether oligo sequences have been intentionally set and should be preserved, or if they can be freely modified. This is particularly important for scaffold strands which often use specific sequences like M13.

## Test Files

- **SequenceLocking.spec.ts** - Comprehensive tests for `Oligo.isSequenceLocked` and `Part.isAllScaffoldSequenceLocked`

## Tested Behavior

### Oligo.isSequenceLocked

#### Locking Behavior

- ✅ Locks when applying a non-random sequence with `lockSequence=true` flag
- ✅ Does NOT lock when applying sequence with `lockSequence=false`
- ✅ Does NOT lock when applying random sequences
- ✅ Can be locked on oligos with single or multiple segments

#### Unlocking Behavior

Sequences are automatically unlocked when any of these structural or sequence modifications occur:

**Sequence Edits:**

- Adding skips (`addSkipOrInsertion` with count < 0)
- Adding insertions (`addSkipOrInsertion` with count > 0)
- Removing skips or insertions (`removeSkipOrInsertion`)
- Moving five prime or three prime ends (`moveOligoTerminusTo`)
- Modifying segment sequences directly (`fillSequence`)

**Structural Changes:**

- Breaking an oligo (`breakOligoAt`)
- Connecting oligos (`connectTwoOligos`)
- Creating crossovers (`createCrossover`)

#### Persistence

- ✅ Lock state is preserved through JSON serialization/deserialization
- ✅ Works correctly with circular oligos
- ✅ Works correctly with multi-segment oligos

### Part.isAllScaffoldSequenceLocked

This derived property returns `true` if ALL scaffold oligos (oligos with `isScaffold=true`) have their sequences locked.

#### Basic Functionality

- ✅ Returns `true` when no scaffold oligos exist
- ✅ Returns `true` when all scaffold oligos are locked
- ✅ Returns `false` when at least one scaffold is unlocked
- ✅ Ignores non-scaffold (staple) oligos

#### Reactivity

The property is a Svelte `$derived` value that automatically updates when:

- Scaffold sequences are locked or unlocked
- Scaffolds are added or removed
- Oligos change scaffold status (`isScaffold` flag changes)

**Note:** In test environments, Svelte reactivity may have slight timing differences. The tests verify the underlying logic is correct even if the derived value update timing varies.

#### Multiple Scaffolds

- ✅ Handles multiple locked scaffolds correctly
- ✅ Detects single unlocked scaffold among many
- ✅ Properly ignores staple oligos when checking

#### Integration

- ✅ Consistent with `Part.hasScaffold` property
- ✅ Works correctly after `autoStaple()` operations
- ✅ Handles circular scaffolds

## Expected Usage Pattern

### Design Workflow Example

```typescript
// 1. Create scaffold
const scaffold = part.createOligo(vh, 0, 20, '#ff0000');
scaffold.isScaffold = true;

// 2. Apply M13 sequence and lock it
scaffold.fillSequence(m13Sequence, true); // lockSequence=true
// scaffold.isSequenceLocked === true
// part.isAllScaffoldSequenceLocked === true

// 3. User adds a skip to adjust design
segment.addSkipOrInsertion(10, -1);
// scaffold.isSequenceLocked === false (auto-unlocked)
// part.isAllScaffoldSequenceLocked === false

// 4. Re-apply corrected sequence
scaffold.fillSequence(adjustedSequence, true);
// scaffold.isSequenceLocked === true
// part.isAllScaffoldSequenceLocked === true

// 5. User extends the scaffold
part.moveOligoTerminusTo(scaffold.threePrime!, 25);
// scaffold.isSequenceLocked === false (auto-unlocked)
// part.isAllScaffoldSequenceLocked === false
```

## Implementation Details

### Locking Mechanism

- `Oligo.isSequenceLocked` is a `$state` property (boolean)
- Lock is set via `Oligo.fillSequence(sequence, lockSequence)` method
- Lock is cleared by `Slot.seq` setter when slot sequences are modified

### Unlocking Mechanism

The unlocking happens automatically at multiple levels:

1. **Slot level**: When `Slot.seq` is set, it checks if the oligo exists and unlocks it
2. **Segment level**: Methods like `addSlot`, `removeSlotAt`, etc. unlock the oligo
3. **Oligo level**: `connectOligos` explicitly unlocks both oligos being connected (structural change)
4. **Part level**: Methods like `moveOligoTerminusTo` modify segments, which unlock

#### Connection/Crossover Unlocking

When oligos are connected (either via direct connection or crossover):

- **Adjacent segments** (`mergeTo`): Unlocks via `takeOverSlotsFrom` → `addSlot` → unlock
- **Non-adjacent segments** (`connectTo`): Unlocks explicitly in `connectOligos` before connection
- **Crossovers** (`createCrossover`): Calls `breakOligoAt` (unlocks) then `connectTwoOligos` (unlocks)

### Derived Value

`Part.isAllScaffoldSequenceLocked` is implemented as:

```typescript
isAllScaffoldSequenceLocked = $derived.by(() => {
	for (const oligo of this.oligos) {
		if (oligo.isScaffold && !oligo.isSequenceLocked) return false;
	}
	return true;
});
```

This automatically tracks changes to:

- The oligos set
- Each oligo's `isScaffold` property
- Each oligo's `isSequenceLocked` property

## Test Statistics

- **Total Tests**: 36
- **Oligo.isSequenceLocked Tests**: 15
- **Part.isAllScaffoldSequenceLocked Tests**: 19
- **Integration Tests**: 2

All tests pass successfully, covering edge cases, reactivity, persistence, and realistic usage scenarios.

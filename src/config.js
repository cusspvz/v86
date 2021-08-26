/*
 * Compile time configuration, some only relevant for debug mode
 */

/**
 * @define {boolean}
 * Overridden for production by closure compiler
 */
export const DEBUG = process.env.DEBUG || false

/** @const */
export const ASYNC_SAFE = true

/** @const */
export const LOG_TO_FILE = false

/**
 * @const
 * Enables logging all IO port reads and writes. Very verbose
 */
export const LOG_ALL_IO = false

/**
 * @const
 */
export const DUMP_GENERATED_WASM = false

/**
 * @const
 */
export const DUMP_UNCOMPILED_ASSEMBLY = false

/**
 * @const
 * More accurate filenames in 9p debug messages at the cost of performance.
 */
export const TRACK_FILENAMES = false

export const LOG_LEVEL =
  LOG_ALL &
  ~LOG_PS2 &
  ~LOG_PIT &
  ~LOG_VIRTIO &
  ~LOG_9P &
  ~LOG_PIC &
  ~LOG_DMA &
  ~LOG_SERIAL &
  ~LOG_NET &
  ~LOG_FLOPPY &
  ~LOG_DISK &
  ~LOG_VGA &
  ~LOG_SB16

/**
 * @const
 * Draws entire buffer and visualizes the layers that would be drawn
 */
export const DEBUG_SCREEN_LAYERS = DEBUG && false

/** @const */
export const ENABLE_HPET = DEBUG && false

/**
 * @const
 * How often, in milliseconds, to yield to the browser for rendering and
 * running events
 */
export const TIME_PER_FRAME = 1

/**
 * @const
 * How many ticks the TSC does per millisecond
 */
export const TSC_RATE = 1 * 1000 * 1000

/** @const */
export const APIC_TIMER_FREQ = TSC_RATE

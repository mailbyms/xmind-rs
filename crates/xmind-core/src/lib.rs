//! `xmind-core` — the mind map domain model, editing operations and layout.
//!
//! Deliberately dependency-light (serde + uuid only). All geometry is computed
//! here in Rust so the WebView only has to draw rectangles, text and paths;
//! no layout library is shipped to the renderer.

pub mod layout;
pub mod model;
pub mod ops;
pub mod shape;
pub mod theme_style;

pub use layout::{compute_layout, palette, Decor, Edge, EffectiveStyle, LaidOutNode, Layout, ThemePalette};
pub use model::*;
pub use ops::*;

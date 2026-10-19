// Whether the ManageRepertoireModal is open. Any page or component can open
// it; the modal itself is rendered at the layout root (outside the header's
// stacking context).

let open = $state(false);

export const manageRepertoires = {
	get open() {
		return open;
	},
	set open(value: boolean) {
		open = value;
	}
};

/* Autogenerated with uFSM */
#ifndef UFSM_CANVAS
#define UFSM_CANVAS

#define UFSM_OK 0
#define UFSM_BAD_ARGUMENT 1
#define UFSM_SIGNAL_QUEUE_FULL 2

/* Events */
#define UFSM_RESET 0
#define UFSM_AUTO_TRANSITION 1
#define eLMBDown 10
#define eLMBUp 11
#define eRMBDown 12
#define eRMBUp 13
#define eMotion 14
#define eKey_r_down 15
#define eKey_g_down 16
#define eKey_esc_down 17
#define eKey_e_down 18
#define eKey_x_down 19
#define eKey_a_down 20
#define eKey_s_down 21
#define eKey_t_down 22
#define eKey_delete_down 23
#define eKey_shift_down 24
#define eKey_shift_up 25
#define eKey_i_down 26
#define eKey_f_down 27
#define eScrollUp 28
#define eScrollDown 29
#define eKey_O_down 30
#define eKey_n_down 31
#define eKey_j_down 32
#define eKey_F_down 33
#define eKey_T_down 34
#define eKey_h_down 35
#define eKey_H_down 36
#define eKey_backspace_down 37
#define eKey_v_down 38
#define eKey_ctrl_down 39
#define eKey_ctrl_up 40
#define eKey_c_down 41
#define eKey_p_down 42
#define eKey_z_down 43
#define eKey_S_down 44
#define eKey_o_down 45

/* Signals */
#define sToolDone 10

/* Guard prototypes */
int canvas_region_selected(void *user);
int canvas_state_selected(void *user);
int canvas_state_resize_selected(void *user);
int canvas_region_resize_selected(void *user);
int canvas_state_entry_selected(void *user);
int canvas_transition_selected(void *user);
int canvas_transition_tvertice_selected(void *user);
int canvas_transition_text_block_selected(void *user);
int canvas_guard_selected(void *user);
int canvas_action_selected(void *user);
int canvas_state_exit_selected(void *user);
int canvas_textblock_resize_selected(void *user);
int canvas_transition_vertice_selected(void *user);
int canvas_transition_selected2(void *user);
int canvas_clicked_on_selected(void *user);
int canvas_selection_count(void *user);
int canvas_check_transition_start(void *user);

/* Action prototypes */
void canvas_select_root_region(void *user);
void canvas_update_offset(void *user);
void canvas_move_state(void *user);
void canvas_resize_state(void *user);
void canvas_resize_region(void *user);
void canvas_reorder_entry_func(void *user);
void canvas_mselect_update(void *user);
void canvas_move_text_block(void *user);
void canvas_move_vertice(void *user);
void canvas_reorder_exit_func(void *user);
void canvas_reorder_guard_func(void *user);
void canvas_reorder_action_func(void *user);
void canvas_resize_textblock(void *user);
void canvas_add_region(void *user);
void canvas_add_entry(void *user);
void canvas_add_exit(void *user);
void canvas_edit_state_name(void *user);
void canvas_edit_state_entry(void *user);
void canvas_edit_state_exit(void *user);
void canvas_delete_entry(void *user);
void canvas_delete_exit(void *user);
void canvas_delete_state(void *user);
void canvas_create_new_state(void *user);
void canvas_create_transition_start(void *user);
void canvas_create_transition(void *user);
void canvas_transition_vdel_last(void *user);
void canvas_add_transition_vertice(void *user);
void canvas_inc_scale(void *user);
void canvas_store_offset(void *user);
void canvas_dec_scale(void *user);
void canvas_resize_state_begin(void *user);
void canvas_save(void *user);
void canvas_process_selection(void *user);
void canvas_check_sresize_boxes(void *user);
void canvas_check_rresize_boxes(void *user);
void canvas_check_action_func(void *user);
void canvas_check_guard(void *user);
void canvas_check_action(void *user);
void canvas_focus_guard(void *user);
void canvas_focus_action(void *user);
void canvas_focus_entry(void *user);
void canvas_focus_exit(void *user);
void canvas_check_text_block(void *user);
void canvas_move_state_begin(void *user);
void canvas_resize_region_begin(void *user);
void canvas_move_state_end(void *user);
void canvas_resize_region_end(void *user);
void canvas_add_guard(void *user);
void canvas_set_transition_trigger(void *user);
void canvas_add_transition_action(void *user);
void canvas_toggle_region_offpage(void *user);
void canvas_edit_region_name(void *user);
void canvas_delete_transition(void *user);
void canvas_delete_guard(void *user);
void canvas_delete_action(void *user);
void canvas_delete_region(void *user);
void canvas_create_join_begin(void *user);
void canvas_create_join_end(void *user);
void canvas_create_join_start(void *user);
void canvas_update_join_preview(void *user);
void canvas_add_join_to_region(void *user);
void canvas_resize_state_end(void *user);
void canvas_rotate_state(void *user);
void canvas_create_fork_begin(void *user);
void canvas_create_fork_end(void *user);
void canvas_create_fork_start(void *user);
void canvas_update_fork_preview(void *user);
void canvas_add_fork_to_region(void *user);
void canvas_create_transition_begin(void *user);
void canvas_create_transition_end(void *user);
void canvas_create_state_begin(void *user);
void canvas_create_state_end(void *user);
void canvas_create_terminate_begin(void *user);
void canvas_create_terminate_end(void *user);
void canvas_terminate_update_preview(void *user);
void canvas_add_terminate_to_region(void *user);
void canvas_new_state_set_start(void *user);
void canvas_new_state_set_end(void *user);
void canvas_create_history_begin(void *user);
void canvas_create_history_end(void *user);
void canvas_history_update_preview(void *user);
void canvas_add_history_to_region(void *user);
void canvas_create_dhistory_begin(void *user);
void canvas_create_dhistory_end(void *user);
void canvas_dhistory_update_preview(void *user);
void canvas_add_dhistory_to_region(void *user);
void canvas_create_init_begin(void *user);
void canvas_create_init_end(void *user);
void canvas_create_final_begin(void *user);
void canvas_create_final_end(void *user);
void canvas_update_init_preview(void *user);
void canvas_add_init_to_region(void *user);
void canvas_update_final_preview(void *user);
void canvas_add_final_to_region(void *user);
void canvas_update_fork_start(void *user);
void canvas_toggle_fork_orientation(void *user);
void canvas_update_join_start(void *user);
void canvas_toggle_join_orientation(void *user);
void canvas_transition_update_preview(void *user);
void canvas_move_text_block_begin(void *user);
void canvas_move_text_block_end(void *user);
void canvas_delete_transition_tvertice(void *user);
void canvas_add_vertice(void *user);
void canvas_resize_text_block_begin(void *user);
void canvas_resize_text_block_end(void *user);
void canvas_move_vertice_begin(void *user);
void canvas_move_vertice_end(void *user);
void canvas_mselect_begin(void *user);
void canvas_mselect_end(void *user);
void canvas_reset_selection(void *user);
void canvas_mselect_move_begin(void *user);
void canvas_mselect_move_end(void *user);
void canvas_mselect_move(void *user);
void canvas_reset_selection2(void *user);
void canvas_focus_selection(void *user);
void canvas_focus_selection(void *user);
void canvas_copy_begin(void *user);
void canvas_copy_end(void *user);
void canvas_paste_copy_buffer(void *user);
void canvas_cut_begin(void *user);
void canvas_cut_end(void *user);
void canvas_paste_cut_buffer(void *user);
void canvas_reset_delta(void *user);
void canvas_mselect_delete(void *user);
void canvas_toggle_theme(void *user);
void canvas_undo(void *user);
void canvas_redo(void *user);
void canvas_reorder_action_begin(void *user);
void canvas_reorder_action_end(void *user);
void canvas_reorder_guard_begin(void *user);
void canvas_reorder_guard_end(void *user);
void canvas_reorder_exit_begin(void *user);
void canvas_reorder_exit_end(void *user);
void canvas_reorder_entry_begin(void *user);
void canvas_reorder_entry_end(void *user);
void canvas_mselect_move_end2(void *user);
void canvas_save_as(void *user);
void canvas_select_all(void *user);
void canvas_add_vertice_begin(void *user);
void canvas_add_vertice_end(void *user);
void canvas_add_vertice_cancel(void *user);
void canvas_nav_toggle(void *user);
void canvas_zoom_fit(void *user);
void canvas_zoom_normal(void *user);
void canvas_ascend(void *user);
void canvas_show_root(void *user);
void canvas_create_annotation_begin(void *user);
void canvas_create_annotation_end(void *user);
void canvas_show_annotation_dialog(void *user);
void canvas_annotation_select_start(void *user);
void canvas_annotation_select_end(void *user);
void canvas_snap_enable_global(void *user);
void canvas_snap_disable_global(void *user);
void canvas_project_settings(void *user);
void canvas_add_begin(void *user);
void canvas_add_end(void *user);
void canvas_tools_begin(void *user);
void canvas_tools_end(void *user);
void canvas_state_select_start_begin(void *user);
void canvas_state_select_start_end(void *user);
void canvas_state_select_end_begin(void *user);
void canvas_state_select_end_end(void *user);
void canvas_select_begin(void *user);
void canvas_select_end(void *user);
void canvas_zoom_begin(void *user);
void canvas_jump_begin(void *user);
void canvas_edit_begin(void *user);
void canvas_delete_begin(void *user);
void canvas_transition_select_source(void *user);
void canvas_transition_select_dest(void *user);
void canvas_add_transition_vertice_mode(void *user);
void canvas_open(void *user);

struct canvas_machine {
    unsigned int csv[55];
    unsigned int wsv[55];
    unsigned int signal[16];
    unsigned int head;
    unsigned int tail;
    void *user;
};

int canvas_process(struct canvas_machine *m, unsigned int event);

#endif  // UFSM_CANVAS

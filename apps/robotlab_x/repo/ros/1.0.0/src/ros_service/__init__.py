"""ros_service — ROS/ROS2 bridge + robot-description toolbox for robotlab_x.

v1 exposes only the URDF/xacro → ik_solver chain export. The package is
laid out so the future ROS bridge (live joint_states, tf, sim) slots in
alongside without reshaping anything:

  pkg_resolver.py   $(find <pkg>) resolution from a package.xml scan
                    (lets xacro expand with no sourced ROS workspace)
  urdf_export.py    pure functions: expand xacro, parse URDF, walk a
                    kinematic chain, project it to an ik_solver model
  service.py        SubprocessService wiring the above to bus actions
"""

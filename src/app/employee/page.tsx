import LogoutButton from "../components/LogoutButton";
import ClockInOut from "../components/ClockInClockOut";

export default function EmployeeDashboard() {
  return (
    <div style={{ padding: 40 }}>
      <h1>Employee Dashboard</h1>
      <p>Employee view — placeholder</p>
      <ClockInOut />
      <LogoutButton />
    </div>
  );
}
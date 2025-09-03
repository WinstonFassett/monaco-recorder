function TodoList({ items }) {
  const [todos, setTodos] = React.useState(items);
  const [newTodo, setNewTodo] = React.useState('');

  const addTodo = () => {
    if (!newTodo.trim()) return;
    setTodos([...todos, { id: Date.now(), text: newTodo }]);
    setNewTodo('');
  };

  const removeTodo = (id) => {
    setTodos(todos.filter(todo => todo.id !== id));
  };

  return (
    <div className="todo-list">
      <div className="add-todo">
        <input 
          value={newTodo}
          onChange={e => setNewTodo(e.target.value)}
          placeholder="Add new todo"
        />
        <button onClick={addTodo}>Add</button>
      </div>
      <ul>
        {todos.map(todo => (
          <li key={todo.id}>
            {todo.text}
            <button onClick={() => removeTodo(todo.id)}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
